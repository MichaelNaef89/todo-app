"""To-do-App-Backend.

Liefert die statische PWA aus (`web/`) und ist die alleinige Datenquelle für
Aufgaben und Projekte (im Unterschied zur Stempeluhr-PWA gibt es hier kein
Offline-First-IndexedDB im Browser - siehe README).

Zugriffsschutz: ein einzelnes App-Passwort (server/local_secrets.py), Session
per httponly-Cookie. Siehe server/auth.py.

    uvicorn server.main:app --host 127.0.0.1 --port 8000
"""

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server.auth import (
    SESSION_COOKIE_NAME,
    create_session,
    delete_session,
    validate_session,
    verify_password,
)
from server.db import get_conn
from server.recurrence import compute_next_due

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

app = FastAPI(title="To-do-App")


# ---------------------------------------------------------------- Modelle --

class TaskIn(BaseModel):
    title: str
    notes: str = ""
    area: str
    project_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    priority: int = 3
    status: str = "open"
    tags: List[str] = []
    link: Optional[str] = None
    assignee: Optional[str] = None
    waiting_person: Optional[str] = None
    waiting_follow_up_date: Optional[str] = None
    recurrence: Optional[dict] = None
    focus_date: Optional[str] = None
    sort_order: int = 0


class ProjectIn(BaseModel):
    name: str
    area: str
    parent_project_id: Optional[int] = None
    notes: str = ""
    sort_order: int = 0
    archived: bool = False


# ------------------------------------------------------------ Validierung --

def require_area(area: str) -> None:
    if area not in ("business", "privat"):
        raise HTTPException(400, "area muss 'business' oder 'privat' sein")


def require_status(status: str) -> None:
    if status not in ("open", "waiting", "done"):
        raise HTTPException(400, "status muss 'open', 'waiting' oder 'done' sein")


def require_priority(priority: int) -> None:
    if priority not in (1, 2, 3, 4):
        raise HTTPException(400, "priority muss zwischen 1 und 4 liegen")


# --------------------------------------------------------------- Mapping --

def row_to_task(row) -> dict:
    d = dict(row)
    d["tags"] = json.loads(d["tags"] or "[]")
    d["recurrence"] = json.loads(d["recurrence"]) if d["recurrence"] else None
    return d


def row_to_project(row, conn) -> dict:
    d = dict(row)
    d["archived"] = bool(d["archived"])
    d["open_count"] = conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status != 'done'", (d["id"],)
    ).fetchone()[0]
    d["done_count"] = conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'done'", (d["id"],)
    ).fetchone()[0]
    d["next_deadline"] = conn.execute(
        "SELECT MIN(due_date) FROM tasks WHERE project_id = ? AND status = 'open' AND due_date IS NOT NULL",
        (d["id"],),
    ).fetchone()[0]
    return d


# ------------------------------------------------------------------ Auth --

@app.post("/api/login")
async def login(request: Request, response: Response):
    body = await request.json()
    password = body.get("password", "")
    try:
        ok = verify_password(password)
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))
    if not ok:
        raise HTTPException(401, "Falsches Passwort")
    conn = get_conn()
    try:
        token = create_session(conn)
    finally:
        conn.close()
    response.set_cookie(
        SESSION_COOKIE_NAME, token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 90
    )
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    conn = get_conn()
    try:
        delete_session(conn, request.cookies.get(SESSION_COOKIE_NAME))
    finally:
        conn.close()
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    conn = get_conn()
    try:
        authenticated = validate_session(conn, request.cookies.get(SESSION_COOKIE_NAME))
    finally:
        conn.close()
    return {"authenticated": authenticated}


@app.get("/api/health")
def health():
    return {"ok": True}


def require_auth(request: Request) -> None:
    conn = get_conn()
    try:
        if not validate_session(conn, request.cookies.get(SESSION_COOKIE_NAME)):
            raise HTTPException(401, "Nicht angemeldet")
    finally:
        conn.close()


api = APIRouter(dependencies=[Depends(require_auth)])


# ----------------------------------------------------------------- Tasks --

@api.get("/tasks")
def list_tasks(
    area: Optional[str] = None,
    project_id: Optional[int] = None,
    status: Optional[str] = None,
    parent_task_id: Optional[int] = None,
    view: Optional[str] = None,
    tag: Optional[str] = None,
    week_start: Optional[str] = None,
):
    conn = get_conn()
    try:
        clauses: List[str] = []
        params: List = []

        if parent_task_id is not None:
            clauses.append("parent_task_id = ?")
            params.append(parent_task_id)
        elif view != "subtasks":
            clauses.append("parent_task_id IS NULL")

        if area:
            require_area(area)
            clauses.append("area = ?")
            params.append(area)
        if project_id is not None:
            clauses.append("project_id = ?")
            params.append(project_id)
        if status:
            require_status(status)
            clauses.append("status = ?")
            params.append(status)
        if tag:
            clauses.append("tags LIKE ?")
            params.append(f'%"{tag}"%')

        today = date.today().isoformat()
        order = "ORDER BY due_date IS NULL, due_date ASC, priority ASC, sort_order ASC"

        if view == "today":
            clauses.append(
                "("
                "(status = 'open' AND due_date IS NOT NULL AND due_date <= ?)"
                " OR (status = 'waiting' AND waiting_follow_up_date IS NOT NULL AND waiting_follow_up_date <= ?)"
                " OR (focus_date = ?)"
                ")"
            )
            params.extend([today, today, today])
        elif view == "planned":
            clauses.append("status = 'open' AND due_date IS NOT NULL AND due_date > ?")
            params.append(today)
        elif view == "inbox":
            clauses.append("project_id IS NULL AND status != 'done'")
        elif view == "waiting":
            clauses.append("status = 'waiting'")
            order = "ORDER BY waiting_follow_up_date IS NULL, waiting_follow_up_date ASC"
        elif view == "done":
            clauses.append("status = 'done'")
            order = "ORDER BY completed_at DESC"
        elif view == "backlog":
            clauses.append("status = 'open' AND due_date IS NULL")
        elif view == "week":
            if not week_start:
                raise HTTPException(400, "week_start (YYYY-MM-DD, Montag) erforderlich für view=week")
            week_end = (date.fromisoformat(week_start) + timedelta(days=6)).isoformat()
            clauses.append("due_date BETWEEN ? AND ?")
            params.extend([week_start, week_end])

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = conn.execute(f"SELECT * FROM tasks {where} {order}", params).fetchall()
        return [row_to_task(r) for r in rows]
    finally:
        conn.close()


@api.get("/tasks/{task_id}")
def get_task(task_id: int):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Aufgabe nicht gefunden")
        task = row_to_task(row)
        subtasks = conn.execute(
            "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY sort_order", (task_id,)
        ).fetchall()
        task["subtasks"] = [row_to_task(t) for t in subtasks]
        return task
    finally:
        conn.close()


def _task_params(task: TaskIn) -> tuple:
    return (
        task.title.strip(),
        task.notes,
        task.area,
        task.project_id,
        task.parent_task_id,
        task.due_date,
        task.due_time,
        task.priority,
        task.status,
        json.dumps(task.tags, ensure_ascii=False),
        task.link,
        task.assignee,
        task.waiting_person,
        task.waiting_follow_up_date,
        json.dumps(task.recurrence, ensure_ascii=False) if task.recurrence else None,
        task.focus_date,
        task.sort_order,
    )


@api.post("/tasks")
def create_task(task: TaskIn):
    require_area(task.area)
    require_status(task.status)
    require_priority(task.priority)
    if not task.title.strip():
        raise HTTPException(400, "title darf nicht leer sein")
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO tasks (title, notes, area, project_id, parent_task_id, due_date, due_time, "
            "priority, status, tags, link, assignee, waiting_person, waiting_follow_up_date, "
            "recurrence, focus_date, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            _task_params(task),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
        return row_to_task(row)
    finally:
        conn.close()


@api.put("/tasks/{task_id}")
def update_task(task_id: int, task: TaskIn):
    require_area(task.area)
    require_status(task.status)
    require_priority(task.priority)
    if not task.title.strip():
        raise HTTPException(400, "title darf nicht leer sein")
    conn = get_conn()
    try:
        existing = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Aufgabe nicht gefunden")
        conn.execute(
            "UPDATE tasks SET title=?, notes=?, area=?, project_id=?, parent_task_id=?, due_date=?, "
            "due_time=?, priority=?, status=?, tags=?, link=?, assignee=?, waiting_person=?, "
            "waiting_follow_up_date=?, recurrence=?, focus_date=?, sort_order=? WHERE id=?",
            _task_params(task) + (task_id,),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return row_to_task(row)
    finally:
        conn.close()


@api.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    conn = get_conn()
    try:
        conn.execute("DELETE FROM tasks WHERE parent_task_id = ?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@api.post("/tasks/{task_id}/complete")
def complete_task(task_id: int):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Aufgabe nicht gefunden")

        now_iso = datetime.now().isoformat(timespec="seconds")
        conn.execute("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?", (now_iso, task_id))
        conn.commit()

        next_task = None
        if row["recurrence"]:
            rule = json.loads(row["recurrence"])
            previous_due = date.fromisoformat(row["due_date"]) if row["due_date"] else None
            next_due = compute_next_due(rule, date.today(), previous_due)
            cur = conn.execute(
                "INSERT INTO tasks (title, notes, area, project_id, parent_task_id, due_date, due_time, "
                "priority, status, tags, link, assignee, recurrence, sort_order) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    row["title"], row["notes"], row["area"], row["project_id"], row["parent_task_id"],
                    next_due.isoformat(), row["due_time"], row["priority"], "open",
                    row["tags"], row["link"], row["assignee"], row["recurrence"], row["sort_order"],
                ),
            )
            conn.commit()
            new_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
            next_task = row_to_task(new_row)

        updated = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return {"task": row_to_task(updated), "next_task": next_task}
    finally:
        conn.close()


@api.post("/tasks/{task_id}/focus")
async def set_focus(task_id: int, request: Request):
    body = await request.json()
    focus_date = body.get("focus_date")
    conn = get_conn()
    try:
        existing = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Aufgabe nicht gefunden")
        conn.execute("UPDATE tasks SET focus_date = ? WHERE id = ?", (focus_date, task_id))
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return row_to_task(row)
    finally:
        conn.close()


# -------------------------------------------------------------- Projekte --

@api.get("/projects")
def list_projects(area: Optional[str] = None, archived: bool = False):
    conn = get_conn()
    try:
        clauses = ["archived = ?"]
        params: List = [1 if archived else 0]
        if area:
            require_area(area)
            clauses.append("area = ?")
            params.append(area)
        where = f"WHERE {' AND '.join(clauses)}"
        rows = conn.execute(f"SELECT * FROM projects {where} ORDER BY sort_order, name", params).fetchall()
        return [row_to_project(r, conn) for r in rows]
    finally:
        conn.close()


@api.get("/projects/{project_id}")
def get_project(project_id: int):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Projekt nicht gefunden")
        project = row_to_project(row, conn)
        tasks = conn.execute(
            "SELECT * FROM tasks WHERE project_id = ? AND parent_task_id IS NULL "
            "ORDER BY status, due_date IS NULL, due_date, priority",
            (project_id,),
        ).fetchall()
        subprojects = conn.execute(
            "SELECT * FROM projects WHERE parent_project_id = ? ORDER BY sort_order, name", (project_id,)
        ).fetchall()
        project["tasks"] = [row_to_task(t) for t in tasks]
        project["subprojects"] = [row_to_project(p, conn) for p in subprojects]
        return project
    finally:
        conn.close()


@api.post("/projects")
def create_project(project: ProjectIn):
    require_area(project.area)
    if not project.name.strip():
        raise HTTPException(400, "name darf nicht leer sein")
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO projects (name, area, parent_project_id, notes, sort_order, archived) "
            "VALUES (?,?,?,?,?,?)",
            (
                project.name.strip(), project.area, project.parent_project_id, project.notes,
                project.sort_order, 1 if project.archived else 0,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (cur.lastrowid,)).fetchone()
        return row_to_project(row, conn)
    finally:
        conn.close()


@api.put("/projects/{project_id}")
def update_project(project_id: int, project: ProjectIn):
    require_area(project.area)
    if not project.name.strip():
        raise HTTPException(400, "name darf nicht leer sein")
    conn = get_conn()
    try:
        existing = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Projekt nicht gefunden")
        conn.execute(
            "UPDATE projects SET name=?, area=?, parent_project_id=?, notes=?, sort_order=?, archived=? "
            "WHERE id=?",
            (
                project.name.strip(), project.area, project.parent_project_id, project.notes,
                project.sort_order, 1 if project.archived else 0, project_id,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return row_to_project(row, conn)
    finally:
        conn.close()


@api.delete("/projects/{project_id}")
def delete_project(project_id: int):
    conn = get_conn()
    try:
        task_count = conn.execute("SELECT COUNT(*) FROM tasks WHERE project_id = ?", (project_id,)).fetchone()[0]
        sub_count = conn.execute(
            "SELECT COUNT(*) FROM projects WHERE parent_project_id = ?", (project_id,)
        ).fetchone()[0]
        if task_count or sub_count:
            raise HTTPException(400, "Projekt enthält noch Aufgaben oder Unterprojekte")
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ------------------------------------------------------------- Suche/Zahlen --

@api.get("/search")
def search(q: str):
    q = q.strip()
    if not q:
        return {"tasks": [], "projects": []}
    like = f"%{q}%"
    conn = get_conn()
    try:
        task_rows = conn.execute(
            "SELECT * FROM tasks WHERE title LIKE ? OR notes LIKE ? OR tags LIKE ? "
            "OR waiting_person LIKE ? OR assignee LIKE ? "
            "ORDER BY status, due_date IS NULL, due_date",
            (like, like, like, like, like),
        ).fetchall()
        project_rows = conn.execute(
            "SELECT * FROM projects WHERE name LIKE ? OR notes LIKE ? ORDER BY name", (like, like)
        ).fetchall()
        return {
            "tasks": [row_to_task(r) for r in task_rows],
            "projects": [row_to_project(r, conn) for r in project_rows],
        }
    finally:
        conn.close()


@api.get("/counts")
def counts():
    today = date.today()
    today_iso = today.isoformat()
    week_start = (today - timedelta(days=today.weekday())).isoformat()
    week_end = (today - timedelta(days=today.weekday()) + timedelta(days=6)).isoformat()
    conn = get_conn()
    try:
        def count(sql: str, params: tuple = ()) -> int:
            return conn.execute(sql, params).fetchone()[0]

        return {
            "today": count(
                "SELECT COUNT(*) FROM tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date <= ?",
                (today_iso,),
            ),
            "focus": count(
                "SELECT COUNT(*) FROM tasks WHERE status = 'open' AND focus_date = ?", (today_iso,)
            ),
            "overdue": count(
                "SELECT COUNT(*) FROM tasks WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ?",
                (today_iso,),
            ),
            "waiting": count("SELECT COUNT(*) FROM tasks WHERE status = 'waiting'"),
            "this_week": count(
                "SELECT COUNT(*) FROM tasks WHERE status = 'open' AND due_date BETWEEN ? AND ?",
                (week_start, week_end),
            ),
        }
    finally:
        conn.close()


app.include_router(api, prefix="/api")

# Statische PWA - als letztes gemountet, damit /api/* zuerst greift.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")

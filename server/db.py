"""SQLite-Zugriff für die To-do-App. Server ist die alleinige Datenquelle
(kein Offline-Cache im Browser wie bei der Stempeluhr-PWA)."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "todo.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL CHECK(area IN ('business','privat')),
  parent_project_id INTEGER REFERENCES projects(id),
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL CHECK(area IN ('business','privat')),
  project_id INTEGER REFERENCES projects(id),
  parent_task_id INTEGER REFERENCES tasks(id),
  due_date TEXT,
  due_time TEXT,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting','done')),
  tags TEXT NOT NULL DEFAULT '[]',
  link TEXT,
  assignee TEXT,
  waiting_person TEXT,
  waiting_follow_up_date TEXT,
  recurrence TEXT,
  focus_date TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_area ON tasks(area);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
"""


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn

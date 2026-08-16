# To-do – Business & Privat

Bewusst minimales persönliches Cockpit mit nur drei Ansichten:

- **Alle** – jede offene Aufgabe, Business und Privat zusammen, unabhängig vom Datum
- **Ausleihe** – Produkte, die verliehen sind (Produkt, Person, Datum, Notiz)
- **Erledigt** – Archiv abgeschlossener Aufgaben

Eine Aufgabe hat nur Titel, Notiz, Bereich, Fälligkeitsdatum/Uhrzeit,
Priorität und optional Verantwortlich/Unteraufgaben/Fokus-Markierung - kein
Projekt-Konzept, keine separaten Heute-/Geplant-/Wochen-Ansichten mehr. Das
war anfangs alles da, ist aber schrittweise auf Wunsch entfernt worden, weil
es im Alltag zu viele Konzepte gleichzeitig waren. Das Backend/Datenmodell
unterstützt vieles davon (Projekte, "Warten auf", Wiederholungsregeln, Tags,
Link, Wochenansicht) weiterhin unter der Haube (siehe unten) – falls sich
das später als nötig erweist, lässt sich die UI dafür ohne Migration
nachrüsten, siehe Git-Historie für die früheren UI-Versionen.

## Architektur

```
server/    FastAPI-Backend: liefert web/ aus, Passwort-Login, /api/tasks, /api/projects, /api/loans
web/       PWA – HTML/CSS/JS, kein Build-Schritt
tools/     Icon-Generator, Passwort setzen
```

Im Unterschied zur Stempeluhr-PWA (siehe deren README zum Vergleich) ist hier
**Server/SQLite die alleinige Datenquelle** – kein Offline-First-IndexedDB im
Browser. Die Datenstruktur ist relationaler (Aufgaben ↔ Projekte ↔ Bereiche ↔
Wiederholungen), das rechtfertigt ein echtes SQL-Schema statt eines
JSON-Blobs pro Eintrag. Ein IndexedDB-Cache für echtes Offline-Arbeiten kann
bei Bedarf später ergänzt werden.

Zugriffsschutz: ein einzelnes App-Passwort (nicht nur Tailnet), Session per
httponly-Cookie. Passwort-Hash liegt in `server/local_secrets.py` (nicht in
Git, siehe `local_secrets.example.py`).

## Lokal einrichten

```powershell
cd "C:\Users\micha\Desktop\Privat\Ensis\Todo\todo-app"
pip install -r server/requirements.txt
python tools/set_password.py      # fragt interaktiv nach einem Passwort
python tools/make_icons.py        # einmalig, erzeugt web/icons/*
uvicorn server.main:app --reload --port 8000
```

Dann `http://localhost:8000/` öffnen. `localhost` gilt als sicherer Kontext –
Service Worker und Installation funktionieren dort bereits.

## Datenmodell

**tasks**: title, notes, area (business/privat), project_id, parent_task_id
(Unteraufgaben), due_date, due_time, priority (1–4), status
(open/waiting/done), tags (JSON-Array), link, assignee, waiting_person,
waiting_follow_up_date, recurrence (JSON-Regel), focus_date, sort_order,
image_filename (Bildnotiz, siehe unten).

**projects**: name, area, parent_project_id (Unterprojekte), notes,
sort_order, archived.

**loans** (Ausleihe, eigener Bereich – kein Task): product, person, area,
lent_date, returned_date (NULL solange draussen), notes. Kein geplantes
Rückgabedatum, bewusst minimal (Produkt/Person/Datum + Notiz).

## Bildnotiz

Beim Anlegen oder Bearbeiten einer Aufgabe lässt sich ein Foto anhängen
(`<input type="file" accept="image/*">` – Mobilbrowser bieten dabei sowohl
Kamera als auch Galerie zur Auswahl an). Der Server skaliert das Bild beim
Upload auf max. 1600px Kantenlänge herunter und speichert es als JPEG
(Qualität 82, analog zum Foto-Resize im Familien-Dashboard) unter
`server/uploads/` – **ausserhalb** von `web/`, damit es nicht am
Passwortschutz vorbei über die unauthentifizierte Static-File-Route
erreichbar ist. Ausgeliefert wird es über den authentifizierten Endpunkt
`GET /api/tasks/{id}/image`. Pro Aufgabe genau ein Bild; erneutes Hochladen
ersetzt das vorherige.

**Projekte, Wiederholungsregeln, "Warten auf", Tags und Link sind aktuell
nicht über die UI erreichbar** (siehe oben) – die Tabellen/API/Logik
(inkl. `server/recurrence.py`) existieren weiter, falls das später
gebraucht wird.

## API (server/main.py)

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/login`, `/api/logout` | Auth |
| GET | `/api/me` | Session-Status |
| GET/POST | `/api/tasks` | Listen (Filter: area, project_id, status, view, tag, week_start) / Anlegen |
| GET/PUT/DELETE | `/api/tasks/{id}` | Aufgabe lesen/ändern/löschen |
| POST | `/api/tasks/{id}/complete` | Erledigen (+ Recurrence-Folgeaufgabe) |
| POST | `/api/tasks/{id}/focus` | Fokus-Datum setzen/entfernen |
| POST/GET/DELETE | `/api/tasks/{id}/image` | Bild hochladen (resized, JPEG) / abrufen / löschen |
| GET/POST | `/api/projects`, `/api/projects/{id}` | Projekte inkl. Fortschritt/Deadline |
| GET | `/api/search?q=` | Suche über Titel/Notizen/Tags/Personen |
| GET | `/api/counts` | Kennzahlen für die Heute-Ansicht |
| GET/POST | `/api/loans` | Ausleihen listen (Filter: area) / anlegen |
| PUT/DELETE | `/api/loans/{id}` | Ausleihe ändern/löschen |
| POST | `/api/loans/{id}/return`, `/api/loans/{id}/unreturn` | Als zurückgegeben markieren / rückgängig machen |

`view`-Werte für `GET /api/tasks`: `today`, `planned`, `inbox`/`waiting`,
`done`, `backlog`, `week` – alle API-seitig vorhanden, UI dafür aktuell
komplett entfernt (nur `all` bzw. eigentlich einfach `?status=open` ohne
`view`, und `done`, sind noch verdrahtet).

## Neue Aufgabe

Der Button "+ Neue Aufgabe" oben öffnet ein schlankes Fenster mit nur
Titel, Notiz, Bereich und Fälligkeitsdatum (keine Uhrzeit, keine
Priorität, keine Unteraufgaben) – Priorität landet auf P3, alles Weitere
lässt sich danach im vollen Bearbeiten-Formular (Klick auf die Aufgabe)
ergänzen.

## Tests

```powershell
python -c "import sys; sys.path.insert(0,'server'); from auth import hash_password; print(hash_password('x'))"
```

Manuell verifiziert (Playwright, headless Chromium): Login, neue Aufgabe
über das schlanke Formular, Bearbeiten-Formular ohne Projekt-Feld, Aufgabe
erledigen → verschwindet aus Alle/erscheint in Erledigt, Ausleihe anlegen –
keine Konsolenfehler.

## Deployment auf dem Pi5

- **Repo**: <https://github.com/MichaelNaef89/todo-app> (öffentlich, keine Secrets enthalten)
- **Pi5**: `/home/pi/todo-app`, venv unter `/home/pi/todo-app/venv`
- **Dienst**: `todo-app.service` → `venv/bin/uvicorn server.main:app --host 127.0.0.1 --port 8003`
- **HTTPS**: `tailscale serve --https=8443` proxyt Port 8003 auf `https://pi5.tail0fe4c7.ts.net:8443/`
  (eigener Port, weil `stempeluhr-pwa.service` bereits den Haupt-HTTPS-Port
  443 von `pi5.tail0fe4c7.ts.net` belegt – beide Dienste laufen parallel)
- **Workflow**:
  ```bash
  # auf dem PC
  git push

  # auf dem Pi
  cd /home/pi/todo-app
  git pull
  venv/bin/pip install -r server/requirements.txt   # nur nötig, wenn sich requirements.txt geändert hat
  sudo systemctl restart todo-app.service
  ```

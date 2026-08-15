"""Einfacher Passwortschutz: ein Passwort für die ganze App, Session-Cookie.

Der Passwort-Hash liegt in server/secrets.py (nicht in Git, siehe
secrets.example.py). tools/set_password.py erzeugt diese Datei.
"""

import hashlib
import importlib
import secrets
import sqlite3
from typing import Optional

PBKDF2_ITERATIONS = 200_000
SESSION_COOKIE_NAME = "todo_session"


def _load_secrets():
    """Lädt server/local_secrets.py unabhängig davon, ob die App als Paket
    (`server.main`) oder als Skript direkt im server/-Ordner gestartet wird.
    Heisst bewusst nicht 'secrets.py', um die gleichnamige Stdlib nicht zu verdecken."""
    for module_name in ("server.local_secrets", "local_secrets"):
        try:
            return importlib.import_module(module_name)
        except ImportError:
            continue
    return None


def hash_password(password: str, salt_hex: Optional[str] = None) -> tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password: str) -> bool:
    cfg = _load_secrets()
    if cfg is None:
        raise RuntimeError(
            "server/local_secrets.py fehlt. Bitte 'python tools/set_password.py' ausführen, "
            "um ein Passwort zu setzen."
        )
    _, computed_hash = hash_password(password, cfg.APP_PASSWORD_SALT)
    return secrets.compare_digest(computed_hash, cfg.APP_PASSWORD_HASH)


def create_session(conn: sqlite3.Connection) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute("INSERT INTO sessions (token) VALUES (?)", (token,))
    conn.commit()
    return token


def validate_session(conn: sqlite3.Connection, token: Optional[str]) -> bool:
    if not token:
        return False
    row = conn.execute("SELECT 1 FROM sessions WHERE token = ?", (token,)).fetchone()
    return row is not None


def delete_session(conn: sqlite3.Connection, token: Optional[str]) -> None:
    if not token:
        return
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()

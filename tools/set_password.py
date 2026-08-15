"""Setzt (oder ändert) das App-Passwort: fragt interaktiv ab und schreibt
server/local_secrets.py mit Salt + PBKDF2-Hash. Kein Klartext wird gespeichert.

    python tools/set_password.py
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
from auth import hash_password  # noqa: E402

TARGET = Path(__file__).resolve().parent.parent / "server" / "local_secrets.py"


def main() -> None:
    password = getpass.getpass("Neues App-Passwort: ")
    confirm = getpass.getpass("Nochmal zur Bestätigung: ")
    if password != confirm:
        print("Passwörter stimmen nicht überein. Abgebrochen.")
        return
    if not password:
        print("Passwort darf nicht leer sein. Abgebrochen.")
        return

    salt_hex, hash_hex = hash_password(password)
    TARGET.write_text(
        f'APP_PASSWORD_SALT = "{salt_hex}"\n'
        f'APP_PASSWORD_HASH = "{hash_hex}"\n',
        encoding="utf-8",
    )
    print(f"Passwort gesetzt, gespeichert in {TARGET}")


if __name__ == "__main__":
    main()

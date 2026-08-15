"""Vorlage für server/local_secrets.py (nicht in Git).

Nicht von Hand ausfüllen - stattdessen einmalig ausführen:

    python tools/set_password.py

Das Skript fragt nach einem Passwort und schreibt server/local_secrets.py
mit den beiden Werten unten automatisch.
"""

APP_PASSWORD_SALT = "hex-salt-hier"
APP_PASSWORD_HASH = "hex-hash-hier"

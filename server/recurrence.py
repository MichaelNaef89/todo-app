"""Berechnet das nächste Fälligkeitsdatum einer wiederkehrenden Aufgabe.

Regeln sind kleine JSON-Objekte (siehe Beispiele unten), gespeichert in
tasks.recurrence. Das nächste Vorkommen wird erst beim Abschliessen der
Aufgabe berechnet und angelegt (Todoist-Prinzip), nicht im Voraus.

Beispiele:
  {"freq": "daily"}
  {"freq": "weekly", "days": ["mon", "wed"]}
  {"freq": "every_n_days", "n": 14}
  {"freq": "every_n_weeks", "n": 2, "days": ["mon"]}
  {"freq": "monthly", "day_of_month": 1}
  {"freq": "monthly_weekday", "week": 1, "weekday": "mon"}   # jeden 1. Montag im Monat
  {"freq": "yearly"}
  {"freq": "after_completion", "days": 3}                     # X Tage nach Abschluss
"""

import calendar
from datetime import date, timedelta

WEEKDAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _next_weekday_on_or_after(start: date, weekday_index: int) -> date:
    delta = (weekday_index - start.weekday()) % 7
    return start + timedelta(days=delta)


def _nth_weekday_of_month(year: int, month: int, week: int, weekday_index: int) -> date:
    first_of_month = date(year, month, 1)
    first_match = _next_weekday_on_or_after(first_of_month, weekday_index)
    return first_match + timedelta(weeks=week - 1)


def _add_months(d: date, months: int) -> date:
    total_month_index = d.month - 1 + months
    year = d.year + total_month_index // 12
    month = total_month_index % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def compute_next_due(rule: dict, completed_on: date, previous_due: "date | None") -> date:
    freq = rule.get("freq")
    anchor = previous_due or completed_on

    if freq == "daily":
        return anchor + timedelta(days=1) if anchor > completed_on else completed_on + timedelta(days=1)

    if freq == "every_n_days":
        n = max(1, int(rule.get("n", 1)))
        return completed_on + timedelta(days=n)

    if freq == "weekly":
        days = [WEEKDAY_CODES.index(d) for d in rule.get("days", ["mon"])]
        candidates = [_next_weekday_on_or_after(completed_on + timedelta(days=1), d) for d in days]
        return min(candidates)

    if freq == "every_n_weeks":
        n = max(1, int(rule.get("n", 1)))
        days = [WEEKDAY_CODES.index(d) for d in rule.get("days", ["mon"])]
        base = anchor + timedelta(weeks=n)
        candidates = [_next_weekday_on_or_after(base, d) for d in days]
        return min(candidates)

    if freq == "monthly":
        day_of_month = int(rule.get("day_of_month", completed_on.day))
        candidate = _add_months(anchor.replace(day=1), 1)
        last_day = calendar.monthrange(candidate.year, candidate.month)[1]
        return candidate.replace(day=min(day_of_month, last_day))

    if freq == "monthly_weekday":
        week = int(rule.get("week", 1))
        weekday_index = WEEKDAY_CODES.index(rule.get("weekday", "mon"))
        next_month = _add_months(anchor.replace(day=1), 1)
        return _nth_weekday_of_month(next_month.year, next_month.month, week, weekday_index)

    if freq == "yearly":
        try:
            return anchor.replace(year=anchor.year + 1)
        except ValueError:  # 29. Februar in einem Nicht-Schaltjahr
            return anchor.replace(year=anchor.year + 1, day=28)

    if freq == "after_completion":
        days = max(1, int(rule.get("days", 1)))
        return completed_on + timedelta(days=days)

    raise ValueError(f"Unbekannte Wiederholungsregel: {freq!r}")

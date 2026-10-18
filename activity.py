"""Итоги периода для «Прогресса»: что сделано по дням — привычки, дела из
календаря, квесты и XP. И сравнение с таким же прошлым периодом."""
from datetime import date, timedelta

import storage

KINDS = ("habits", "plans", "quests")


def by_day(user_id: int, start: date, end: date) -> dict:
    """{iso_date: {"habits", "plans", "quests", "xp"}} за [start, end]."""
    a, b = start.isoformat(), end.isoformat()
    conn = storage.connect()
    out = {}

    def add(rows, key):
        for d, n in rows:
            out.setdefault(d, {"habits": 0, "plans": 0, "quests": 0, "xp": 0})[key] += n or 0

    add(conn.execute("""SELECT l.local_date, COUNT(*) FROM habit_logs l JOIN habits h ON h.id = l.habit_id
                        WHERE l.user_id = ? AND l.done = 1 AND COALESCE(h.kind, 'build') = 'build'
                        AND l.local_date BETWEEN ? AND ? GROUP BY l.local_date""", (user_id, a, b)).fetchall(), "habits")
    add(conn.execute("""SELECT date, COUNT(*) FROM plans WHERE user_id = ? AND status = 'done'
                        AND COALESCE(repeat_rule, 'none') = 'none' AND date BETWEEN ? AND ? GROUP BY date""",
                     (user_id, a, b)).fetchall(), "plans")
    add(conn.execute("""SELECT e.date, COUNT(*) FROM plan_exceptions e JOIN plans p ON p.id = e.plan_id
                        WHERE p.user_id = ? AND e.status = 'done' AND e.date BETWEEN ? AND ? GROUP BY e.date""",
                     (user_id, a, b)).fetchall(), "plans")
    add(conn.execute("""SELECT local_date, COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'
                        AND local_date BETWEEN ? AND ? GROUP BY local_date""", (user_id, a, b)).fetchall(), "quests")
    add(conn.execute("""SELECT local_date, SUM(amount) FROM xp_log WHERE user_id = ? AND local_date BETWEEN ? AND ?
                        GROUP BY local_date""", (user_id, a, b)).fetchall(), "xp")
    conn.close()
    return out


def _totals(days: dict) -> dict:
    t = {k: sum(v[k] for v in days.values()) for k in (*KINDS, "xp")}
    t["active_days"] = sum(1 for v in days.values() if any(v[k] for k in KINDS))
    return t


def summary(user_id: int, start: date, end: date, compare: bool = True) -> dict:
    days = by_day(user_id, start, end)
    span = (end - start).days + 1
    series = []
    for i in range(span):
        d = (start + timedelta(days=i)).isoformat()
        v = days.get(d, {"habits": 0, "plans": 0, "quests": 0, "xp": 0})
        series.append({"date": d, **v, "total": v["habits"] + v["plans"] + v["quests"]})
    best = max(series, key=lambda x: x["total"]) if series else None
    prev = None
    if compare:
        p_end = start - timedelta(days=1)
        prev = _totals(by_day(user_id, p_end - timedelta(days=span - 1), p_end))
    return {"series": series, "totals": _totals(days), "prev": prev, "days": span,
            "best_day": {"date": best["date"], "total": best["total"]} if best and best["total"] else None}

"""Лига с сезонами. Сезон — календарный месяц. Очки те же, что в лиге недели
(квест 3, привычка 1, дело 1), считаются с первого числа. В начале нового
месяца прошлый сезон закрывается: место среди своих друзей фиксируется,
за топ-3 — XP, победителю — титул «Чемпион месяца» рядом с именем."""

from calendar import monthrange
from datetime import date, timedelta

import friends
import game
import storage

SEASON_XP = {1: 150, 2: 100, 3: 60}
MIN_MEMBERS = 2  # один в лиге — не сезон


def ensure_tables():
    c = storage.connect()
    c.execute("""CREATE TABLE IF NOT EXISTS league_results (
        user_id INTEGER NOT NULL, period TEXT NOT NULL, rank INTEGER NOT NULL, points INTEGER NOT NULL,
        members INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, created_at TEXT,
        PRIMARY KEY (user_id, period))""")
    c.commit()
    c.close()


MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август",
          "сентябрь", "октябрь", "ноябрь", "декабрь"]
MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
              "сентября", "октября", "ноября", "декабря"]


def period_of(d: date) -> str:
    return d.strftime("%Y-%m")


def label(period: str, genitive: bool = False) -> str:
    m = int(period.split("-")[1])
    return (MONTHS_GEN if genitive else MONTHS)[m - 1]


def _range(period: str):
    y, m = (int(x) for x in period.split("-"))
    return date(y, m, 1).isoformat(), date(y, m, monthrange(y, m)[1]).isoformat()


def points(conn, user_id: int, start: str, end: str) -> dict:
    q = conn.execute("""SELECT COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'
                        AND local_date BETWEEN ? AND ?""", (user_id, start, end)).fetchone()[0]
    hb = conn.execute("""SELECT COUNT(*) FROM habit_logs l JOIN habits h ON h.id = l.habit_id
                         WHERE l.user_id = ? AND l.done = 1 AND l.local_date BETWEEN ? AND ?
                         AND COALESCE(h.kind, 'build') = 'build'""", (user_id, start, end)).fetchone()[0]
    pl = conn.execute("""SELECT COUNT(*) FROM plans WHERE user_id = ? AND status = 'done' AND date BETWEEN ? AND ?
                         AND COALESCE(repeat_rule, 'none') = 'none'""", (user_id, start, end)).fetchone()[0]
    pl += conn.execute("""SELECT COUNT(*) FROM plan_exceptions e JOIN plans p ON p.id = e.plan_id
                          WHERE p.user_id = ? AND e.status = 'done' AND e.date BETWEEN ? AND ?""", (user_id, start, end)).fetchone()[0]
    P = friends.POINTS
    return {"quests": q, "habits": hb, "plans": pl, "points": q * P["quest"] + hb * P["habit"] + pl * P["plan"]}


def _circle(conn, user_id: int) -> list:
    ids = [r[0] for r in conn.execute("SELECT friend_id FROM friends WHERE user_id = ?", (user_id,)).fetchall()]
    return [user_id] + ids


def _table(conn, user_id: int, period: str) -> list:
    start, end = _range(period)
    rows = []
    for uid in _circle(conn, user_id):
        u = storage.get_user(uid)
        if not u:
            continue
        p = points(conn, uid, start, end)
        rows.append({"id": uid, "name": u.get("first_name") or u.get("username") or "Друг", "me": uid == user_id, **p})
    rows.sort(key=lambda r: (-r["points"], -r["quests"], r["name"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


def close_previous(user_id: int, today: date) -> dict:
    """Закрыть прошлый сезон для этого пользователя, если ещё не закрыт. Возвращает итог или None."""
    ensure_tables()
    prev = period_of(today.replace(day=1) - timedelta(days=1))
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM league_results WHERE user_id = ? AND period = ?", (user_id, prev)).fetchone()
    if row:
        conn.close()
        return dict(row)
    table = _table(conn, user_id, prev)
    me = next((r for r in table if r["me"]), None)
    members = len(table)
    if not me or members < MIN_MEMBERS or me["points"] <= 0:
        rank, pts, xp = (me["rank"] if me else 0), (me["points"] if me else 0), 0
    else:
        rank, pts = me["rank"], me["points"]
        xp = SEASON_XP.get(rank, 0)
    conn.execute("""INSERT OR IGNORE INTO league_results (user_id, period, rank, points, members, xp, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""", (user_id, prev, rank, pts, members, xp, storage.utc_now_str()))
    conn.commit()
    conn.close()
    if xp:
        game.add_xp(user_id, xp, f"league:{prev}", today.isoformat())
    return {"user_id": user_id, "period": prev, "rank": rank, "points": pts, "members": members, "xp": xp}


def view(user_id: int) -> dict:
    """Сезон для вкладки «Друзья»: таблица месяца, итог прошлого сезона, титулы."""
    ensure_tables()
    me = storage.get_user(user_id)
    today = game.local_today(me)
    period = period_of(today)
    last = close_previous(user_id, today)
    conn = storage.connect(rows=True)
    table = _table(conn, user_id, period)
    prev = last["period"]
    # титулы: кто из круга выиграл прошлый сезон (в своём круге) и сколько побед всего
    ids = [r["id"] for r in table]
    champs = {r[0] for r in conn.execute(
        f"SELECT user_id FROM league_results WHERE period = ? AND rank = 1 AND members >= ? AND user_id IN ({','.join('?' * len(ids))})",
        (prev, MIN_MEMBERS, *ids)).fetchall()} if ids else set()
    wins = {r[0]: r[1] for r in conn.execute(
        f"SELECT user_id, COUNT(*) FROM league_results WHERE rank = 1 AND members >= ? AND user_id IN ({','.join('?' * len(ids))}) GROUP BY user_id",
        (MIN_MEMBERS, *ids)).fetchall()} if ids else {}
    conn.close()
    for r in table:
        r["champion"] = r["id"] in champs
        r["wins"] = wins.get(r["id"], 0)
    days_left = monthrange(today.year, today.month)[1] - today.day
    return {"period": period, "label": label(period), "days_left": days_left, "rows": table,
            "last": {**last, "label": label(prev), "fresh": today.day <= 7 and last["members"] >= MIN_MEMBERS and last["points"] > 0},
            "rewards": SEASON_XP}

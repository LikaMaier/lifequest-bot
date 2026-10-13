"""Челленджи: N дней подряд выполнять хотя бы один квест (иногда — из
определённой сферы). Пропустил день — челлендж не засчитан, можно начать
заново. За прохождение — XP и запись в «Наградах». Одновременно — один."""

from datetime import date, timedelta

import game
import storage

# id, эмодзи, название, дней, сфера (None — любой квест), награда XP, только Premium
CHALLENGES = [
    ("brave7", "🦁", "7 дней смелости", 7, "Смелость", 150, False),
    ("energy7", "⚡", "7 дней энергии", 7, "Энергия", 150, False),
    ("create7", "🎨", "7 дней творчества", 7, "Творчество", 150, False),
    ("any14", "🔥", "14 дней без скуки", 14, None, 350, False),
    ("any30", "🚀", "30 дней новой жизни", 30, None, 900, True),
]
BY_ID = {c[0]: c for c in CHALLENGES}


def _public(c) -> dict:
    cid, emoji, title, days, sphere, xp, premium = c
    rule = f"каждый день — квест из сферы «{sphere}»" if sphere else "каждый день — любой квест"
    return {"id": cid, "emoji": emoji, "title": title, "days": days, "sphere": sphere,
            "xp": xp, "premium": premium, "rule": rule}


def _active_row(conn, user_id: int):
    return conn.execute("""SELECT id, challenge_id, start_date FROM user_challenges
                           WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1""",
                        (user_id,)).fetchone()


def _days_met(user_id: int, c, start: date, today: date) -> set:
    sphere = c[4]
    conn = storage.connect()
    sql = """SELECT DISTINCT local_date FROM quest_history WHERE user_id = ? AND status = 'done'
             AND local_date >= ? AND local_date <= ?"""
    args = [user_id, start.isoformat(), today.isoformat()]
    if sphere:
        sql += " AND sphere = ?"
        args.append(sphere)
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return {r[0] for r in rows}


def progress(user_id: int, today: date = None):
    """Активный челлендж с прогрессом по дням или None."""
    user = storage.get_user(user_id)
    today = today or game.local_today(user)
    conn = storage.connect()
    row = _active_row(conn, user_id)
    conn.close()
    if not row or row[1] not in BY_ID:
        return None
    c = BY_ID[row[1]]
    start = date.fromisoformat(row[2])
    met = _days_met(user_id, c, start, today)
    days = []
    for i in range(c[3]):
        d = start + timedelta(days=i)
        state = "done" if d.isoformat() in met else "today" if d == today else "missed" if d < today else "future"
        days.append({"date": d.isoformat(), "state": state})
    done = sum(1 for d in days if d["state"] == "done")
    return {**_public(c), "row_id": row[0], "start": row[2], "day_list": days, "done": done,
            "day": min(c[3], (today - start).days + 1), "today_done": today.isoformat() in met,
            "failed": any(d["state"] == "missed" for d in days)}


def check(user_id: int) -> dict:
    """После выполнения квеста / открытия приложения: засчитываем победу или провал.
    Возвращает {"completed": {...}} или {"failed": {...}} или {}."""
    p = progress(user_id)
    if not p:
        return {}
    conn = storage.connect()
    if p["failed"]:
        conn.execute("UPDATE user_challenges SET status = 'failed', finished_at = ? WHERE id = ?",
                     (storage.utc_now_str(), p["row_id"]))
        conn.commit()
        conn.close()
        return {"failed": {"id": p["id"], "title": p["title"], "done": p["done"], "days": p["days"]}}
    if p["done"] >= p["days"]:
        cur = conn.execute("UPDATE user_challenges SET status = 'done', finished_at = ? WHERE id = ? AND status = 'active'",
                           (storage.utc_now_str(), p["row_id"]))
        conn.commit()
        conn.close()
        if cur.rowcount == 1:
            user = storage.get_user(user_id)
            game.add_xp(user_id, p["xp"], f"challenge:{p['id']}", game.local_today(user).isoformat())
            return {"completed": {"id": p["id"], "title": p["title"], "emoji": p["emoji"], "xp": p["xp"]}}
        return {}
    conn.close()
    return {}


def start(user_id: int, cid: str) -> dict:
    if cid not in BY_ID:
        raise game.QuestError("Такого челленджа нет")
    c = BY_ID[cid]
    user = storage.get_user(user_id)
    if c[6] and not game.is_premium(user):
        raise game.QuestError("Этот челлендж — для Premium 💛", code="challenge")
    check(user_id)  # закрыть старый, если он уже провален
    conn = storage.connect()
    if _active_row(conn, user_id):
        conn.close()
        raise game.QuestError("Сначала заверши текущий челлендж — или сдайся в нём 🙂")
    conn.execute("""INSERT INTO user_challenges (user_id, challenge_id, start_date, status, started_at)
                    VALUES (?, ?, ?, 'active', ?)""",
                 (user_id, cid, game.local_today(user).isoformat(), storage.utc_now_str()))
    conn.commit()
    conn.close()
    return view(user_id)


def quit_active(user_id: int) -> dict:
    conn = storage.connect()
    conn.execute("UPDATE user_challenges SET status = 'quit', finished_at = ? WHERE user_id = ? AND status = 'active'",
                 (storage.utc_now_str(), user_id))
    conn.commit()
    conn.close()
    return view(user_id)


def view(user_id: int) -> dict:
    result = check(user_id)
    conn = storage.connect()
    rows = conn.execute("""SELECT challenge_id, COUNT(*) FROM user_challenges
                           WHERE user_id = ? AND status = 'done' GROUP BY challenge_id""", (user_id,)).fetchall()
    conn.close()
    wins = dict(rows)
    premium = game.is_premium(storage.get_user(user_id))
    return {
        "active": progress(user_id),
        "last_result": result,
        "list": [{**_public(c), "wins": wins.get(c[0], 0), "locked": c[6] and not premium} for c in CHALLENGES],
    }


def summary(user_id: int):
    """Коротко для главной: активный челлендж без списка дней."""
    p = progress(user_id)
    if not p or p["failed"]:
        return None
    return {k: p[k] for k in ("id", "emoji", "title", "days", "done", "day", "today_done", "sphere")}

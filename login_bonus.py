"""Бонус за вход: заходишь каждый день подряд — XP растёт.
День 1 — 10 XP, дальше +5 за каждый день (до 60), каждый 7-й день — ×2
и новый маскот. Пропустил день — серия входов начинается заново."""
from datetime import date, timedelta

import game
import storage

BASE, STEP, CAP = 10, 5, 60


def reward(day: int) -> int:
    xp = min(CAP, BASE + STEP * (max(1, day) - 1))
    return xp * 2 if day % 7 == 0 else xp


def _streak_today(user: dict, today: date):
    """(день серии, получен ли бонус сегодня)."""
    last, streak = user.get("login_day"), user.get("login_streak") or 0
    if last == today.isoformat():
        return streak, True
    if last == (today - timedelta(days=1)).isoformat():
        return streak + 1, False
    return 1, False


def status(user_id: int) -> dict:
    user = storage.get_user(user_id)
    today = game.local_today(user)
    day, claimed = _streak_today(user, today)
    start = (day - 1) // 7 * 7 + 1  # текущая неделя серии: дни start..start+6
    track = [{"day": d, "xp": reward(d), "state": "done" if d < day or (d == day and claimed) else "today" if d == day else "next"}
             for d in range(start, start + 7)]
    locked = [(k, n) for k, n, _lv in game.MASCOTS][game.mascots_open(user):] if not game.is_premium(user) else []
    # ближайший 7-й день серии, который ещё впереди (сегодняшний — если бонус не забран)
    mascot_day = -(-day // 7) * 7
    if claimed and mascot_day == day:
        mascot_day += 7
    return {"day": day, "claimed": claimed, "xp": reward(day), "next_xp": reward(day + 1), "track": track,
            "next_mascot": {"id": locked[0][0], "name": locked[0][1], "day": mascot_day,
                            "in_days": mascot_day - day} if locked else None}


def claim(user_id: int) -> dict:
    user = storage.get_user(user_id)
    today = game.local_today(user)
    day, claimed = _streak_today(user, today)
    if claimed:
        return {"claimed": False, "login": status(user_id)}
    conn = storage.connect()
    cur = conn.execute("UPDATE users SET login_day = ?, login_streak = ? WHERE user_id = ? AND COALESCE(login_day, '') <> ?",
                       (today.isoformat(), day, user_id, today.isoformat()))
    conn.commit()
    conn.close()
    if not cur.rowcount:  # второй запрос в ту же секунду
        return {"claimed": False, "login": status(user_id)}
    xp = reward(day)
    before = game.level_info(user.get("xp") or 0)["level"]
    game.add_xp(user_id, xp, "login", today.isoformat())
    after = game.level_info(storage.get_user(user_id).get("xp") or 0)
    mascot = game.open_next_mascot(user_id) if day % 7 == 0 and not game.is_premium(user) else None
    return {"claimed": True, "xp": xp, "level_up": after if after["level"] > before else None, "mascot": mascot,
            "login": status(user_id)}

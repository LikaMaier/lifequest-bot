# ============================================================
# LIFEQUEST — трекер привычек
# Пользователь сам придумывает привычки (название, эмодзи, цвет), задаёт,
# сколько раз в день их нужно выполнить, и отмечает выполнение +/−.
# XP за привычку начисляется один раз в день — когда достигнута дневная цель.
# ============================================================

from datetime import date, timedelta

import game
import storage

COLORS = ("blue", "pink", "yellow", "lav", "red", "orange", "purple", "lime")
HABITS_LIMIT = 20
TITLE_MAX = 40
UNIT_MAX = 12
EMOJI_MAX = 8
TARGET_MAX = 50
COUNT_MAX = 99
HABIT_XP = 3
EDITABLE_DAYS = 7  # отмечать можно сегодня и за 6 прошлых дней


def _clean_text(value, limit: int, name: str, required: bool = False) -> str:
    text = " ".join(str(value or "").split())[:limit]
    if required and not text:
        raise game.QuestError(f"Напиши {name}")
    return text


def _clean_fields(data: dict, partial: bool) -> dict:
    fields = {}
    if not partial or "title" in data:
        fields["title"] = _clean_text(data.get("title"), TITLE_MAX, "название привычки", required=True)
    if not partial or "emoji" in data:
        fields["emoji"] = _clean_text(data.get("emoji"), EMOJI_MAX, "эмодзи") or "✨"
    if not partial or "color" in data:
        color = data.get("color")
        fields["color"] = color if color in COLORS else "lime"
    if not partial or "unit" in data:
        fields["unit"] = _clean_text(data.get("unit"), UNIT_MAX, "единицу")
    if not partial or "target" in data:
        try:
            fields["target"] = max(1, min(TARGET_MAX, int(data.get("target") or 1)))
        except (TypeError, ValueError):
            raise game.QuestError("Сколько раз в день — число от 1 до 50")
    return fields


def _get(user_id: int, habit_id: int) -> dict:
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0",
                       (habit_id, user_id)).fetchone()
    conn.close()
    if not row:
        raise game.QuestError("Такой привычки больше нет")
    return dict(row)


def create_habit(user_id: int, data: dict) -> dict:
    fields = _clean_fields(data, partial=False)
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM habits WHERE user_id = ? AND archived = 0", (user_id,)).fetchone()[0]
    if n >= HABITS_LIMIT:
        conn.close()
        raise game.QuestError(f"Привычек уже {HABITS_LIMIT} — это максимум. Убери какую-нибудь, чтобы добавить новую.")
    cur = conn.execute("INSERT INTO habits (user_id, title, emoji, color, target, unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (user_id, fields["title"], fields["emoji"], fields["color"], fields["target"], fields["unit"],
                        storage.utc_now_str()))
    conn.commit()
    habit_id = cur.lastrowid
    conn.close()
    return {"habit": habit_view(user_id, habit_id), "new_achievements": game.check_achievements(user_id)}


def update_habit(user_id: int, habit_id: int, data: dict) -> dict:
    _get(user_id, habit_id)
    fields = _clean_fields(data, partial=True)
    if fields:
        cols = ", ".join(f"{k} = ?" for k in fields)
        conn = storage.connect()
        conn.execute(f"UPDATE habits SET {cols} WHERE id = ? AND user_id = ?", (*fields.values(), habit_id, user_id))
        if "target" in fields:
            # новая цель сразу пересчитывает отметку «выполнено» за сегодня
            today = game.local_today(storage.get_user(user_id)).isoformat()
            conn.execute("UPDATE habit_logs SET done = (count >= ?) WHERE habit_id = ? AND local_date = ?",
                         (fields["target"], habit_id, today))
        conn.commit()
        conn.close()
    return {"habit": habit_view(user_id, habit_id)}


def delete_habit(user_id: int, habit_id: int) -> dict:
    """Привычка уходит из списка, но её история остаётся в статистике."""
    _get(user_id, habit_id)
    conn = storage.connect()
    conn.execute("UPDATE habits SET archived = 1 WHERE id = ? AND user_id = ?", (habit_id, user_id))
    conn.commit()
    conn.close()
    return {"ok": True}


def log_habit(user_id: int, habit_id: int, delta: int = None, count: int = None, day: str = None) -> dict:
    """Меняет счётчик привычки за день (+1 / −1 или точное значение).
    XP — один раз за день, когда счётчик впервые дошёл до цели."""
    habit = _get(user_id, habit_id)
    user = storage.get_user(user_id)
    today = game.local_today(user)
    target_day = today
    if day:
        try:
            target_day = date.fromisoformat(str(day))
        except ValueError:
            raise game.QuestError("Некорректная дата")
        if not (today - timedelta(days=EDITABLE_DAYS - 1) <= target_day <= today):
            raise game.QuestError("Отмечать можно только последние 7 дней")
    d = target_day.isoformat()

    conn = storage.connect()
    row = conn.execute("SELECT count FROM habit_logs WHERE habit_id = ? AND local_date = ?", (habit_id, d)).fetchone()
    current = row[0] if row else 0
    try:
        new = int(count) if count is not None else current + int(delta if delta is not None else 1)
    except (TypeError, ValueError):
        conn.close()
        raise game.QuestError("Некорректное значение")
    new = max(0, min(COUNT_MAX, new))
    done = 1 if new >= habit["target"] else 0
    conn.execute("""
        INSERT INTO habit_logs (habit_id, user_id, local_date, count, done, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(habit_id, local_date) DO UPDATE SET count = excluded.count, done = excluded.done, updated_at = excluded.updated_at
    """, (habit_id, user_id, d, new, done, storage.utc_now_str()))
    reason = f"habit:{habit_id}:{d}"
    already = conn.execute("SELECT 1 FROM xp_log WHERE user_id = ? AND reason = ?", (user_id, reason)).fetchone()
    conn.commit()
    conn.close()

    xp = 0
    level_up = None
    if done and not already:
        xp = HABIT_XP
        level_before = game.level_for_xp(user.get("xp") or 0)
        game.add_xp(user_id, xp, reason, d)
        xp_total = (user.get("xp") or 0) + xp
        if game.level_for_xp(xp_total) > level_before:
            level_up = game.level_info(xp_total)
    return {"habit": habit_view(user_id, habit_id), "xp": xp, "level_up": level_up,
            "just_done": bool(done and not (current >= habit["target"])),
            "new_achievements": game.check_achievements(user_id) if done else []}


def _streak(done_days: set, today: date) -> int:
    """Дни подряд с выполненной целью: считаем от сегодня, а если сегодня
    ещё не отмечено — от вчера (серия не сгорает до конца дня)."""
    day = today if today.isoformat() in done_days else today - timedelta(days=1)
    n = 0
    while day.isoformat() in done_days:
        n += 1
        day -= timedelta(days=1)
    return n


def _views(user_id: int, rows: list) -> list:
    today = game.local_today(storage.get_user(user_id))
    start = today - timedelta(days=365)
    conn = storage.connect(rows=True)
    logs = conn.execute("""SELECT habit_id, local_date, count, done FROM habit_logs
                           WHERE user_id = ? AND local_date >= ?""", (user_id, start.isoformat())).fetchall()
    conn.close()
    by_habit = {}
    for r in logs:
        by_habit.setdefault(r["habit_id"], {})[r["local_date"]] = (r["count"], r["done"])
    result = []
    for h in rows:
        days = by_habit.get(h["id"], {})
        done_days = {d for d, (_c, dn) in days.items() if dn}
        week = []
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            c, dn = days.get(d, (0, 0))
            week.append({"date": d, "count": c, "done": bool(dn)})
        result.append({
            "id": h["id"], "title": h["title"], "emoji": h["emoji"] or "✨", "color": h["color"] or "lime",
            "target": h["target"] or 1, "unit": h["unit"] or "",
            "today": days.get(today.isoformat(), (0, 0))[0],
            "done_today": today.isoformat() in done_days,
            "week": week, "streak": _streak(done_days, today),
            "total_days": len(done_days),
        })
    return result


def habit_view(user_id: int, habit_id: int) -> dict:
    return _views(user_id, [_get(user_id, habit_id)])[0]


def habits_view(user_id: int) -> list:
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute("SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY id",
                                          (user_id,)).fetchall()]
    conn.close()
    return _views(user_id, rows)


def summary(user_id: int) -> dict:
    items = habits_view(user_id)
    return {"total": len(items), "done": sum(1 for h in items if h["done_today"]), "items": items}


def evening_text(user_id: int) -> str:
    """Блок для вечернего напоминания бота: что из привычек уже сделано,
    а что ещё осталось. Пустая строка — если привычек нет. Названия придумывает
    пользователь, поэтому они экранируются для HTML-разметки Telegram."""
    import html
    items = habits_view(user_id)
    if not items:
        return ""
    done = [h for h in items if h["done_today"]]
    left = [h for h in items if not h["done_today"]]
    lines = [f"🌱 <b>Привычки: {len(done)} из {len(items)}</b>"]
    if not left:
        lines.append("Все привычки на сегодня выполнены — так держать! 🎉")
    else:
        for h in left:
            progress = f" — {h['today']}/{h['target']}{(' ' + h['unit']) if h['unit'] else ''}" if h["target"] > 1 else ""
            lines.append(f"▫️ {html.escape(h['emoji'])} {html.escape(h['title'])}{html.escape(progress)}")
        if done:
            lines.append("✅ " + ", ".join(html.escape(h["title"]) for h in done))
    return "\n".join(lines)

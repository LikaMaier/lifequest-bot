# ============================================================
# LIFEQUEST — трекер привычек
# Привычка «делать» (build): сколько раз в день, по какому расписанию
# (каждый день / по дням недели / N раз в неделю), в какое время дня и с
# личным напоминанием. Привычка «бросить» (quit): считаем дни без срыва,
# отмечаются только срывы.
# XP за привычку «делать» начисляется один раз в день — когда достигнута
# дневная цель. Пропуск с причиной и пауза (отпуск, болезнь) серию не рвут.
# ============================================================

from datetime import date, datetime, timedelta

import game
import habit_catalog
import storage
import spheres as user_spheres

COLORS = ("blue", "pink", "yellow", "lav", "red", "orange", "purple", "lime")
KINDS = ("build", "quit")
SCHEDULES = ("daily", "days", "weekly")
TIMES_OF_DAY = ("morning", "day", "evening", "any")
HABITS_LIMIT = 20
TITLE_MAX = 40
UNIT_MAX = 12
EMOJI_MAX = 8
TARGET_MAX = 50
COUNT_MAX = 99
HABIT_XP = 3
EDITABLE_DAYS = 7  # отмечать можно сегодня и за 6 прошлых дней
NOTE_MAX = 120
PAUSE_MAX_DAYS = 30
REMIND_WINDOW_MIN = 10
HISTORY_DAYS = 400


def _clean_text(value, limit: int, name: str, required: bool = False) -> str:
    text = " ".join(str(value or "").split())[:limit]
    if required and not text:
        raise game.QuestError(f"Напиши {name}")
    return text


def _clean_time(value):
    t = str(value or "").strip()
    if not t:
        return None
    try:
        hh, mm = t.split(":")[:2]
        hh, mm = int(hh), int(mm)
    except (ValueError, TypeError):
        raise game.QuestError("Время напоминания в формате ЧЧ:ММ")
    if not (0 <= hh <= 23 and 0 <= mm <= 59):
        raise game.QuestError("Время напоминания в формате ЧЧ:ММ")
    return f"{hh:02d}:{mm:02d}"


def _clean_fields(data: dict, partial: bool, user_id: int = None) -> dict:
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
    if not partial or "sphere" in data:
        sp = data.get("sphere")
        if sp and user_id is not None and sp in user_spheres.BANK and sp not in user_spheres.keys(user_id):
            user_spheres.enable(user_id, [sp])  # привычка из каталога включает свою сферу банка
        fields["sphere"] = sp if sp and user_id is not None and sp in user_spheres.keys(user_id) else None
    if not partial:  # готовая привычка из банка — чтобы показать подсказку на карточке
        fields["bank_key"] = data.get("bank_key") if habit_catalog.by_key(data.get("bank_key")) else None
    if not partial or "target" in data:
        try:
            fields["target"] = max(1, min(TARGET_MAX, int(data.get("target") or 1)))
        except (TypeError, ValueError):
            raise game.QuestError("Сколько раз в день — число от 1 до 50")
    if not partial or "kind" in data:
        fields["kind"] = data.get("kind") if data.get("kind") in KINDS else "build"
    if not partial or "schedule" in data:
        fields["schedule"] = data.get("schedule") if data.get("schedule") in SCHEDULES else "daily"
    if not partial or "days" in data:
        days = str(data.get("days") or "")
        fields["days"] = days if len(days) == 7 and set(days) <= {"0", "1"} and "1" in days else "1111111"
    if not partial or "per_week" in data:
        try:
            fields["per_week"] = max(1, min(7, int(data.get("per_week") or 3)))
        except (TypeError, ValueError):
            raise game.QuestError("Сколько раз в неделю — число от 1 до 7")
    if not partial or "time_of_day" in data:
        fields["time_of_day"] = data.get("time_of_day") if data.get("time_of_day") in TIMES_OF_DAY else "any"
    if not partial or "remind_time" in data:
        fields["remind_time"] = _clean_time(data.get("remind_time"))
    if fields.get("kind") == "quit":
        fields.update(schedule="daily", target=1, remind_time=None)
    return fields


def _get(user_id: int, habit_id: int) -> dict:
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM habits WHERE id = ? AND user_id = ? AND archived = 0",
                       (habit_id, user_id)).fetchone()
    conn.close()
    if not row:
        raise game.QuestError("Такой привычки больше нет")
    return dict(row)


def _today(user_id: int) -> date:
    return game.local_today(storage.get_user(user_id))


# ==================== РАСПИСАНИЕ И ПАУЗА ====================
def scheduled_on(h: dict, d: date) -> bool:
    """Нужно ли делать привычку в этот день (для weekly — любой день недели)."""
    if (h.get("schedule") or "daily") == "days":
        days = h.get("days") or "1111111"
        return days[d.weekday()] == "1"
    return True


def paused_days(user_id: int, start: date, end: date) -> set:
    conn = storage.connect()
    rows = conn.execute("SELECT start, end FROM habit_pauses WHERE user_id = ? AND end >= ? AND start <= ?",
                        (user_id, start.isoformat(), end.isoformat())).fetchall()
    conn.close()
    out = set()
    for a, b in rows:
        d = max(date.fromisoformat(a), start)
        last = min(date.fromisoformat(b), end)
        while d <= last:
            out.add(d.isoformat())
            d += timedelta(days=1)
    return out


def current_pause(user_id: int):
    today = _today(user_id)
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT start, end FROM habit_pauses WHERE user_id = ? AND end >= ? AND start <= ? ORDER BY id DESC",
                       (user_id, today.isoformat(), today.isoformat())).fetchone()
    conn.close()
    return dict(row) if row else None


def set_pause(user_id: int, days) -> dict:
    """Пауза на N дней с сегодняшнего: привычки не требуются, серии не горят."""
    try:
        days = int(days)
    except (TypeError, ValueError):
        raise game.QuestError("На сколько дней пауза?")
    if not 1 <= days <= PAUSE_MAX_DAYS:
        raise game.QuestError(f"Пауза — от 1 до {PAUSE_MAX_DAYS} дней")
    today = _today(user_id)
    conn = storage.connect()
    conn.execute("DELETE FROM habit_pauses WHERE user_id = ? AND start >= ?", (user_id, today.isoformat()))
    conn.execute("UPDATE habit_pauses SET end = ? WHERE user_id = ? AND end >= ?",
                 ((today - timedelta(days=1)).isoformat(), user_id, today.isoformat()))
    conn.execute("INSERT INTO habit_pauses (user_id, start, end) VALUES (?, ?, ?)",
                 (user_id, today.isoformat(), (today + timedelta(days=days - 1)).isoformat()))
    conn.commit()
    conn.close()
    return {"pause": current_pause(user_id)}


def end_pause(user_id: int) -> dict:
    today = _today(user_id)
    conn = storage.connect()
    conn.execute("DELETE FROM habit_pauses WHERE user_id = ? AND start >= ?", (user_id, today.isoformat()))
    conn.execute("UPDATE habit_pauses SET end = ? WHERE user_id = ? AND end >= ?",
                 ((today - timedelta(days=1)).isoformat(), user_id, today.isoformat()))
    conn.commit()
    conn.close()
    return {"pause": None}


# ==================== ИЗМЕНЕНИЕ ====================
def create_habit(user_id: int, data: dict) -> dict:
    fields = _clean_fields(data, partial=False, user_id=user_id)
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM habits WHERE user_id = ? AND archived = 0", (user_id,)).fetchone()[0]
    if n >= HABITS_LIMIT:
        conn.close()
        raise game.QuestError(f"Привычек уже {HABITS_LIMIT} — это максимум. Убери какую-нибудь, чтобы добавить новую.")
    cols = list(fields)
    cur = conn.execute(f"INSERT INTO habits (user_id, {', '.join(cols)}, created_at) VALUES (?, {', '.join('?' * len(cols))}, ?)",
                       (user_id, *fields.values(), storage.utc_now_str()))
    conn.commit()
    habit_id = cur.lastrowid
    conn.close()
    return {"habit": habit_view(user_id, habit_id), "new_achievements": game.check_achievements(user_id)}


def create_many(user_id: int, items: list) -> dict:
    """Несколько привычек сразу — из шаблонов на старте."""
    if not isinstance(items, list) or not items:
        raise game.QuestError("Выбери хотя бы одну привычку")
    created = [create_habit(user_id, dict(it))["habit"] for it in items[:5] if isinstance(it, dict)]
    return {"habits": created, "new_achievements": game.check_achievements(user_id)}


def update_habit(user_id: int, habit_id: int, data: dict) -> dict:
    _get(user_id, habit_id)
    fields = _clean_fields(data, partial=True, user_id=user_id)
    if fields:
        cols = ", ".join(f"{k} = ?" for k in fields)
        conn = storage.connect()
        conn.execute(f"UPDATE habits SET {cols} WHERE id = ? AND user_id = ?", (*fields.values(), habit_id, user_id))
        if "target" in fields:
            # новая цель сразу пересчитывает отметку «выполнено» за сегодня
            today = _today(user_id).isoformat()
            conn.execute("UPDATE habit_logs SET done = (count >= ?) WHERE habit_id = ? AND local_date = ?",
                         (fields["target"], habit_id, today))
        if "remind_time" in fields:
            conn.execute("UPDATE habits SET remind_sent = NULL WHERE id = ?", (habit_id,))
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


def _target_day(user_id: int, day) -> tuple:
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
    return user, today, target_day


def _bridge_pause(user_id: int, day: date):
    """Если между прошлой отметкой серии и этим днём была только пауза —
    продлеваем общую серию так, будто пропусков не было."""
    user = storage.get_user(user_id)
    last = user.get("streak_last_date")
    if not last:
        return
    try:
        prev = date.fromisoformat(last)
    except ValueError:
        return
    if (day - prev).days <= 1:
        return
    gap_start, gap_end = prev + timedelta(days=1), day - timedelta(days=1)
    gap = paused_days(user_id, gap_start, gap_end)
    if len(gap) == (gap_end - gap_start).days + 1:
        storage.update_user(user_id, streak_last_date=gap_end.isoformat())


def log_habit(user_id: int, habit_id: int, delta: int = None, count: int = None, day: str = None) -> dict:
    """Меняет счётчик привычки за день (+1 / −1 или точное значение).
    Для «бросить» счётчик — это срывы за день. XP — один раз за день,
    когда счётчик привычки «делать» впервые дошёл до цели."""
    habit = _get(user_id, habit_id)
    user, today, target_day = _target_day(user_id, day)
    d = target_day.isoformat()
    quit_habit = habit.get("kind") == "quit"

    conn = storage.connect()
    row = conn.execute("SELECT count FROM habit_logs WHERE habit_id = ? AND local_date = ?", (habit_id, d)).fetchone()
    current = row[0] if row else 0
    try:
        new = int(count) if count is not None else current + int(delta if delta is not None else 1)
    except (TypeError, ValueError):
        conn.close()
        raise game.QuestError("Некорректное значение")
    new = max(0, min(COUNT_MAX, new))
    done = 0 if quit_habit else (1 if new >= habit["target"] else 0)
    conn.execute("""
        INSERT INTO habit_logs (habit_id, user_id, local_date, count, done, skipped, note, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
        ON CONFLICT(habit_id, local_date) DO UPDATE SET count = excluded.count, done = excluded.done,
            skipped = 0, note = NULL, updated_at = excluded.updated_at
    """, (habit_id, user_id, d, new, done, storage.utc_now_str()))
    reason = f"habit:{habit_id}:{d}"
    already = conn.execute("SELECT 1 FROM xp_log WHERE user_id = ? AND reason = ?", (user_id, reason)).fetchone()
    conn.commit()
    conn.close()

    xp = 0
    level_up = None
    streak = None
    if not quit_habit:
        if done and not already:
            xp = HABIT_XP
            level_before = game.level_for_xp(user.get("xp") or 0)
            game.add_xp(user_id, xp, reason, d)
            xp_total = (user.get("xp") or 0) + xp
            if game.level_for_xp(xp_total) > level_before:
                level_up = game.level_info(xp_total)
        # Общая серия дней — по привычкам: хотя бы одна выполненная привычка за день.
        conn = storage.connect()
        any_done = conn.execute("SELECT 1 FROM habit_logs WHERE user_id = ? AND local_date = ? AND done = 1 LIMIT 1",
                                (user_id, d)).fetchone()
        conn.close()
        if any_done:
            _bridge_pause(user_id, target_day)
            streak = game.habit_streak_tick(user_id, target_day)
        else:
            game.habit_streak_untick(user_id, target_day)
    view = habit_view(user_id, habit_id)
    return {"habit": view, "xp": xp, "level_up": level_up,
            "just_done": bool(done and not (current >= habit["target"])),
            "streak": streak, "milestone": _milestone(view) if done and not already else None,
            "new_achievements": game.check_achievements(user_id) if done else []}


def skip_habit(user_id: int, habit_id: int, day: str = None, note: str = "") -> dict:
    """Пропуск с причиной: день не засчитан, но и серию не рвёт."""
    _get(user_id, habit_id)
    _user, _today_d, target_day = _target_day(user_id, day)
    d = target_day.isoformat()
    text = _clean_text(note, NOTE_MAX, "причину")
    conn = storage.connect()
    conn.execute("""
        INSERT INTO habit_logs (habit_id, user_id, local_date, count, done, skipped, note, updated_at)
        VALUES (?, ?, ?, 0, 0, 1, ?, ?)
        ON CONFLICT(habit_id, local_date) DO UPDATE SET count = 0, done = 0, skipped = 1, note = excluded.note,
            updated_at = excluded.updated_at
    """, (habit_id, user_id, d, text, storage.utc_now_str()))
    conn.commit()
    conn.close()
    return {"habit": habit_view(user_id, habit_id)}


MILESTONES = (7, 21, 30, 50, 100, 200, 365)


def _milestone(view: dict):
    """Круглая серия — повод для карточки «N дней подряд»."""
    if view["kind"] == "build" and view["streak_unit"] == "day" and view["streak"] in MILESTONES:
        return {"days": view["streak"], "title": view["title"], "emoji": view["emoji"]}
    return None


def done_by_sphere(user_id: int, start: date, end: date) -> dict:
    """Сколько раз за период выполнены привычки каждой сферы (день цели = 1)."""
    conn = storage.connect()
    rows = conn.execute("""SELECT h.sphere, COUNT(*) FROM habit_logs l JOIN habits h ON h.id = l.habit_id
                           WHERE l.user_id = ? AND l.done = 1 AND h.sphere IS NOT NULL
                             AND l.local_date BETWEEN ? AND ? GROUP BY h.sphere""",
                        (user_id, start.isoformat(), end.isoformat())).fetchall()
    conn.close()
    return dict(rows)


# ==================== СЕРИИ ====================
def _created(h: dict) -> date:
    raw = (h.get("created_at") or "")[:10]
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return date.min


def _first_day(h: dict, logs: dict) -> date:
    """С какого дня считать привычку: создание или самая ранняя отметка
    (прошлые дни можно отметить задним числом)."""
    first = _created(h)
    if logs:
        first = min(first, date.fromisoformat(min(logs)))
    return first


def _day_state(h: dict, d: date, logs: dict, paused: set) -> str:
    """done | skip | pause | off (не по расписанию) | miss."""
    iso = d.isoformat()
    count, done, skipped = logs.get(iso, (0, 0, 0))
    if done:
        return "done"
    if skipped:
        return "skip"
    if iso in paused:
        return "pause"
    if not scheduled_on(h, d):
        return "off"
    return "miss"


def _day_streaks(h: dict, logs: dict, paused: set, today: date) -> tuple:
    """(текущая, лучшая) серия в днях. Пропуск, пауза и «не по расписанию»
    серию не рвут и не добавляют. Сегодня ещё можно успеть — не обрывает."""
    start = max(_first_day(h, logs), today - timedelta(days=HISTORY_DAYS))
    run = best = 0
    d = start
    while d <= today:
        st = _day_state(h, d, logs, paused)
        if st == "done":
            run += 1
            best = max(best, run)
        elif st == "miss" and d != today:
            run = 0
        d += timedelta(days=1)
    return run, best


def _week_streaks(h: dict, logs: dict, paused: set, today: date) -> tuple:
    """Для «N раз в неделю»: серия недель, где цель набрана. Текущая неделя
    засчитывается, когда набрана; недели почти целиком на паузе не рвут серию."""
    per_week = h.get("per_week") or 3
    monday = today - timedelta(days=today.weekday())
    first = _first_day(h, logs)
    first_monday = max(first, today - timedelta(days=HISTORY_DAYS))
    first_monday -= timedelta(days=first_monday.weekday())
    run = best = 0
    w = first_monday
    while w <= monday:
        days = [w + timedelta(days=i) for i in range(7)]
        done = sum(1 for d in days if logs.get(d.isoformat(), (0, 0, 0))[1])
        paused_n = sum(1 for d in days if d.isoformat() in paused)
        if done >= per_week:
            run += 1
            best = max(best, run)
        elif w != monday and paused_n < 4:
            run = 0
        w += timedelta(days=7)
    return run, best


def _quit_streaks(h: dict, logs: dict, today: date) -> tuple:
    """Для «бросить»: дни без срыва сейчас и рекорд."""
    start = max(_created(h), today - timedelta(days=HISTORY_DAYS))
    run = best = 0
    d = start
    while d <= today:
        if logs.get(d.isoformat(), (0, 0, 0))[0] > 0:
            run = 0
        else:
            run += 1
            best = max(best, run)
        d += timedelta(days=1)
    return run, best


def _logs_by_habit(user_id: int, since: date) -> dict:
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT habit_id, local_date, count, done, COALESCE(skipped, 0) AS skipped FROM habit_logs
                           WHERE user_id = ? AND local_date >= ?""", (user_id, since.isoformat())).fetchall()
    conn.close()
    by_habit = {}
    for r in rows:
        by_habit.setdefault(r["habit_id"], {})[r["local_date"]] = (r["count"], r["done"], r["skipped"])
    return by_habit


def _tip(bank_key):
    """Подсказка с карточки готовой привычки: зачем и как начать с малого."""
    item = habit_catalog.by_key(bank_key)
    return {"tiny": item["tiny"], "why": item["why"]} if item else None


def _views(user_id: int, rows: list) -> list:
    today = _today(user_id)
    since = today - timedelta(days=HISTORY_DAYS)
    by_habit = _logs_by_habit(user_id, since)
    paused = paused_days(user_id, since, today)
    monday = today - timedelta(days=today.weekday())
    result = []
    for h in rows:
        logs = by_habit.get(h["id"], {})
        kind = h.get("kind") or "build"
        schedule = h.get("schedule") or "daily"
        if kind == "quit":
            streak, best = _quit_streaks(h, logs, today)
            unit = "day"
        elif schedule == "weekly":
            streak, best = _week_streaks(h, logs, paused, today)
            unit = "week"
        else:
            streak, best = _day_streaks(h, logs, paused, today)
            unit = "day"
        week = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            c, dn, sk = logs.get(d.isoformat(), (0, 0, 0))
            week.append({"date": d.isoformat(), "count": c, "done": bool(dn), "skipped": bool(sk),
                         "state": _day_state(h, d, logs, paused) if kind == "build" else ("slip" if c else "clean")})
        t_count, t_done, t_skip = logs.get(today.isoformat(), (0, 0, 0))
        week_done = sum(1 for i in range(7) if logs.get((monday + timedelta(days=i)).isoformat(), (0, 0, 0))[1])
        per_week = h.get("per_week") or 3
        is_paused = today.isoformat() in paused
        if kind == "quit":
            due = False
        elif schedule == "weekly":
            due = not is_paused and (week_done < per_week or bool(t_done))
        else:
            due = not is_paused and scheduled_on(h, today)
        result.append({
            "id": h["id"], "title": h["title"], "emoji": h["emoji"] or "✨", "color": h["color"] or "lime",
            "target": h["target"] or 1, "unit": h["unit"] or "", "sphere": h["sphere"],
            "kind": kind, "schedule": schedule, "days": h.get("days") or "1111111", "per_week": per_week,
            "time_of_day": h.get("time_of_day") or "any", "remind_time": h.get("remind_time"),
            "today": t_count, "done_today": bool(t_done), "skipped_today": bool(t_skip),
            "due_today": due, "week_done": week_done, "paused": is_paused,
            "week": week, "streak": streak, "best": best, "streak_unit": unit,
            "total_days": sum(1 for v in logs.values() if v[1]),
            "slips_today": t_count if kind == "quit" else 0,
            "tip": _tip(h.get("bank_key")),
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
    """Сводка на сегодня: только привычки «делать», которые нужны сегодня."""
    items = habits_view(user_id)
    due = [h for h in items if h["kind"] == "build" and h["due_today"]]
    return {"total": len(due), "done": sum(1 for h in due if h["done_today"]), "items": items,
            "pause": current_pause(user_id)}


def stats(user_id: int, habit_id: int) -> dict:
    """Карточка привычки: сетка за 17 недель, выполнение по дням недели,
    процент за 30 дней, серия и рекорд."""
    h = _get(user_id, habit_id)
    view = _views(user_id, [h])[0]
    today = _today(user_id)
    end = today + timedelta(days=6 - today.weekday())  # до воскресенья этой недели
    start = end - timedelta(days=17 * 7 - 1)
    logs = _logs_by_habit(user_id, start).get(habit_id, {})
    paused = paused_days(user_id, start, today)
    created = _first_day(h, logs)
    grid = []
    d = start
    while d <= end:
        if d > today:
            st = "future"
        elif d < created:
            st = "before"
        elif view["kind"] == "quit":
            st = "slip" if logs.get(d.isoformat(), (0, 0, 0))[0] else "clean"
        else:
            st = _day_state(h, d, logs, paused)
            if st == "miss" and d == today:
                st = "today"  # день ещё не кончился — это не пропуск
        grid.append({"date": d.isoformat(), "state": st})
        d += timedelta(days=1)
    # по дням недели за 12 недель: доля выполненных из запланированных
    by_wd = []
    for wd in range(7):
        due = done = 0
        for k in range(12):
            day = today - timedelta(days=(today.weekday() - wd) % 7 + 7 * k)
            if day < created or day >= today:
                continue
            st = _day_state(h, day, logs, paused) if view["kind"] == "build" else None
            if st in ("done", "miss"):
                due += 1
                done += st == "done"
        by_wd.append(round(done / due * 100) if due else None)
    window = [today - timedelta(days=i) for i in range(30)]
    window = [d for d in window if d != today or logs.get(d.isoformat(), (0, 0, 0))[1]]
    states = [_day_state(h, d, logs, paused) for d in window if d >= created]
    due30 = sum(1 for s in states if s in ("done", "miss"))
    rate = round(sum(1 for s in states if s == "done") / due30 * 100) if due30 else 0
    weak = None
    valid = [(v, i) for i, v in enumerate(by_wd) if v is not None]
    if view["kind"] == "build" and len(valid) >= 5:
        worst = min(valid)
        if worst[0] < 60 and max(valid)[0] - worst[0] >= 20:
            weak = worst[1]
    return {"habit": view, "grid": grid, "weekday": by_wd, "rate30": rate, "weak_weekday": weak,
            "milestones": [{"days": m, "reached": view["best"] >= m} for m in MILESTONES if view["streak_unit"] == "day"]}


# ==================== НАПОМИНАНИЯ ====================
def due_reminders(now_utc: datetime = None) -> list:
    """Личные напоминания привычек: [(user_id, view)]. Каждое — раз в день,
    если привычка нужна сегодня и ещё не сделана."""
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute("""SELECT h.*, u.tz FROM habits h JOIN users u ON u.user_id = h.user_id
                                              WHERE h.archived = 0 AND h.remind_time IS NOT NULL
                                                AND COALESCE(h.kind, 'build') = 'build'
                                                AND COALESCE(u.blocked, 0) = 0""").fetchall()]
    conn.close()
    result = []
    for h in rows:
        now = game.local_now({"tz": h["tz"]}) if now_utc is None else _to_local(now_utc, h["tz"])
        today = now.date().isoformat()
        if h.get("remind_sent") == today:
            continue
        hh, mm = map(int, h["remind_time"].split(":"))
        at = datetime(now.year, now.month, now.day, hh, mm)
        if not (at <= now < at + timedelta(minutes=REMIND_WINDOW_MIN)):
            continue
        view = _views(h["user_id"], [h])[0]
        if view["due_today"] and not view["done_today"] and not view["skipped_today"]:
            result.append((h["user_id"], view))
    return result


def mark_reminded(habit_id: int, day: str):
    conn = storage.connect()
    conn.execute("UPDATE habits SET remind_sent = ? WHERE id = ?", (day, habit_id))
    conn.commit()
    conn.close()


def _to_local(now_utc: datetime, tz: str) -> datetime:
    if tz and game.valid_tz(tz):
        from zoneinfo import ZoneInfo
        return now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(tz)).replace(tzinfo=None)
    return now_utc


def evening_text(user_id: int) -> str:
    """Блок для вечернего напоминания бота: что из привычек уже сделано,
    а что ещё осталось. Пустая строка — если привычек на сегодня нет. Названия
    придумывает пользователь, поэтому они экранируются для HTML-разметки Telegram."""
    import html
    items = [h for h in habits_view(user_id) if h["kind"] == "build" and h["due_today"]]
    if not items:
        return ""
    done = [h for h in items if h["done_today"]]
    left = [h for h in items if not h["done_today"] and not h["skipped_today"]]
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

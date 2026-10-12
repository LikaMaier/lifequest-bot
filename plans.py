# ============================================================
# LIFEQUEST — календарь планов
# План — задание из банка (solo/pair/company) или свой план (free) на дату.
# Повторяющийся план хранится одной строкой с правилом повтора; судьба
# отдельных дней (выполнен / отпущен / перенесён) — в plan_exceptions.
# Выполнение задания идёт через game.accept_quest + game.complete_quest,
# поэтому XP, серия, ачивки и цель дня считаются так же, как обычно.
# Даты — YYYY-MM-DD в часовом поясе пользователя.
# ============================================================

import re
from datetime import date, datetime, timedelta

import game
import storage
from quests_database import CATALOG

MODES = ("solo", "pair", "company", "free")
COLORS = ("lime", "blue", "pink", "yellow", "lav", "orange", "purple", "red")
REPEATS = ("none", "daily", "weekdays", "weekly")
REMINDS = ("none", "at_time", "hour_before")
TITLE_MAX = 80
NOTE_MAX = 500
PLANS_LIMIT = 500
FREE_PLAN_XP = 2
PAST_DAYS = 366
FUTURE_DAYS = 730
RANGE_MAX_DAYS = 120
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


# ==================== ВАЛИДАЦИЯ ====================
def _today(user_id: int) -> date:
    return game.local_today(storage.get_user(user_id))


def parse_date(value, name: str = "дата") -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        raise game.QuestError(f"Некорректная {name}")


def _check_window(d: date, today: date):
    if not (today - timedelta(days=PAST_DAYS) <= d <= today + timedelta(days=FUTURE_DAYS)):
        raise game.QuestError("Дата слишком далеко — выбери в пределах двух лет")


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _clean(data: dict, today: date, partial: bool) -> dict:
    f = {}
    if "quest_key" in data and data.get("quest_key"):
        q = CATALOG.get(str(data["quest_key"]))
        if not q:
            raise game.QuestError("Такого задания нет в банке")
        f["quest_key"] = q["id"]
        f["mode"] = q["mode"]
        tier = data.get("tier")
        f["tier"] = tier if tier in q["tiers"] else ("medium" if "medium" in q["tiers"] else next(iter(q["tiers"])))
        if not _text(data.get("title"), TITLE_MAX):
            f["title"] = q["title"]
    elif not partial:
        f["mode"] = "free"
        f["quest_key"] = None
    if not partial or "title" in data:
        title = _text(data.get("title"), TITLE_MAX)
        if title:
            f["title"] = title
        elif "title" not in f:
            raise game.QuestError("Напиши, что планируешь")
    if not partial or "note" in data:
        f["note"] = str(data.get("note") or "").strip()[:NOTE_MAX]
    if not partial or "date" in data:
        d = parse_date(data.get("date"))
        _check_window(d, today)
        f["date"] = d.isoformat()
    if not partial or "time" in data:
        t = str(data.get("time") or "").strip()
        if t and not _TIME_RE.match(t):
            raise game.QuestError("Время в формате ЧЧ:ММ")
        f["time"] = t or None
    if not partial or "color" in data:
        c = data.get("color")
        f["color"] = c if c in COLORS else None
    if not partial or "repeat_rule" in data:
        r = data.get("repeat_rule") or "none"
        if r not in REPEATS:
            raise game.QuestError("Неизвестный повтор")
        f["repeat_rule"] = r
    if not partial or "remind" in data:
        r = data.get("remind") or "none"
        if r not in REMINDS:
            raise game.QuestError("Неизвестное напоминание")
        f["remind"] = r
    if not partial or "board_cell" in data:
        cell = data.get("board_cell")
        if cell is None or cell == "":
            f["board_cell"] = None
            f["board_week"] = None
        else:
            try:
                cell = int(cell)
            except (TypeError, ValueError):
                raise game.QuestError("Некорректная клетка карты")
            if not 0 <= cell < storage.BOARD_CELLS:
                raise game.QuestError("Некорректная клетка карты")
            f["board_cell"] = cell
            f["board_week"] = storage.get_current_week_key(today)
    return f


# ==================== ПОВТОРЫ ====================
def occurs_on(plan: dict, d: date) -> bool:
    start = date.fromisoformat(plan["date"])
    if d < start:
        return False
    rule = plan.get("repeat_rule") or "none"
    if rule == "none":
        return d == start
    if rule == "daily":
        return True
    if rule == "weekdays":
        return d.weekday() < 5
    if rule == "weekly":
        return d.weekday() == start.weekday()
    return False


def first_occurrence(plan: dict) -> date:
    """Первый день серии: у «по будням», начатого в выходной, это понедельник."""
    d = date.fromisoformat(plan["date"])
    for _ in range(8):
        if occurs_on(plan, d):
            return d
        d += timedelta(days=1)
    return date.fromisoformat(plan["date"])


def _dates(plan: dict, start: date, end: date):
    if (plan.get("repeat_rule") or "none") == "none":
        d = date.fromisoformat(plan["date"])
        if start <= d <= end:
            yield d
        return
    d = max(start, date.fromisoformat(plan["date"]))
    while d <= end:
        if occurs_on(plan, d):
            yield d
        d += timedelta(days=1)


# ==================== ЧТЕНИЕ ====================
def _get(user_id: int, plan_id: int) -> dict:
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM plans WHERE id = ? AND user_id = ?", (plan_id, user_id)).fetchone()
    conn.close()
    if not row:
        raise game.QuestError("Такого плана нет")
    return dict(row)


def _plans_for_range(user_id: int, start: date, end: date) -> list:
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT * FROM plans WHERE user_id = ? AND date <= ?
                           AND (repeat_rule <> 'none' OR date >= ?)""",
                        (user_id, end.isoformat(), start.isoformat())).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _exceptions(plan_ids: list) -> dict:
    if not plan_ids:
        return {}
    conn = storage.connect(rows=True)
    q = ",".join("?" * len(plan_ids))
    rows = conn.execute(f"SELECT * FROM plan_exceptions WHERE plan_id IN ({q})", plan_ids).fetchall()
    conn.close()
    return {(r["plan_id"], r["date"]): dict(r) for r in rows}


def _photo_counts(user_id: int) -> dict:
    conn = storage.connect()
    rows = conn.execute("""SELECT plan_id, plan_date, COUNT(*) FROM photos WHERE user_id = ? AND plan_id IS NOT NULL
                           GROUP BY plan_id, plan_date""", (user_id,)).fetchall()
    conn.close()
    return {(r[0], r[1]): r[2] for r in rows}


def _occurrence(plan: dict, d: date, exc: dict, today: date, photos: dict) -> dict:
    iso = d.isoformat()
    if (plan.get("repeat_rule") or "none") != "none":
        e = exc.get((plan["id"], iso))
        status = e["status"] if e else "planned"
    else:
        status = plan["status"] or "planned"
    q = CATALOG.get(plan["quest_key"]) if plan.get("quest_key") else None
    return {
        "id": plan["id"], "date": iso, "time": plan["time"], "title": plan["title"], "note": plan["note"] or "",
        "mode": plan["mode"] or "free", "quest_key": plan["quest_key"], "tier": plan["tier"],
        "quest": game.public_quest(q, plan["tier"]) if q else None,
        "color": plan["color"], "repeat_rule": plan["repeat_rule"] or "none", "remind": plan["remind"] or "none",
        "board_cell": plan["board_cell"], "status": status,
        "overdue": status == "planned" and d < today,
        "photos": photos.get((plan["id"], iso), 0),
    }


def occurrences(user_id: int, start: date, end: date) -> list:
    if (end - start).days > RANGE_MAX_DAYS:
        raise game.QuestError("Слишком большой период")
    today = _today(user_id)
    plans = _plans_for_range(user_id, start, end)
    exc = _exceptions([p["id"] for p in plans])
    photos = _photo_counts(user_id)
    items = []
    for p in plans:
        for d in _dates(p, start, end):
            o = _occurrence(p, d, exc, today, photos)
            if o["status"] != "moved":
                items.append(o)
    items.sort(key=lambda o: (o["date"], o["time"] or "99:99", o["id"]))
    return items


def occurrence(user_id: int, plan_id: int, d: date) -> dict:
    plan = _get(user_id, plan_id)
    if not occurs_on(plan, d):
        raise game.QuestError("В этот день плана нет")
    return _occurrence(plan, d, _exceptions([plan_id]), _today(user_id), _photo_counts(user_id))


def today_plans(user_id: int) -> list:
    t = _today(user_id)
    return [o for o in occurrences(user_id, t, t) if o["status"] == "planned"]


def overdue_plans(user_id: int, days: int = 14) -> list:
    t = _today(user_id)
    return [o for o in occurrences(user_id, t - timedelta(days=days), t - timedelta(days=1)) if o["overdue"]]


def month_summary(user_id: int, month: str) -> dict:
    try:
        first = datetime.strptime(month, "%Y-%m").date()
    except (TypeError, ValueError):
        raise game.QuestError("Месяц в формате ГГГГ-ММ")
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    items = occurrences(user_id, first, last)
    conn = storage.connect()
    photo_days = {r[0] for r in conn.execute("""
        SELECT COALESCE(day, plan_date, substr(created_at, 1, 10)) FROM photos
        WHERE user_id = ? AND COALESCE(day, plan_date, substr(created_at, 1, 10)) BETWEEN ? AND ?""",
        (user_id, first.isoformat(), last.isoformat())).fetchall()}
    quest_days = dict(conn.execute("""SELECT local_date, COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'
                                      AND local_date BETWEEN ? AND ? GROUP BY local_date""",
                                   (user_id, first.isoformat(), last.isoformat())).fetchall())
    conn.close()
    days = {}
    for o in items:
        dd = days.setdefault(o["date"], {"modes": [], "planned": 0, "done": 0, "overdue": 0})
        if o["mode"] not in dd["modes"]:
            dd["modes"].append(o["mode"])
        if o["status"] == "done":
            dd["done"] += 1
        elif o["status"] == "planned":
            dd["planned"] += 1
            dd["overdue"] += 1 if o["overdue"] else 0
    result = []
    d = first
    while d <= last:
        iso = d.isoformat()
        dd = days.get(iso, {"modes": [], "planned": 0, "done": 0, "overdue": 0})
        total = dd["planned"] + dd["done"]
        result.append({**dd, "date": iso, "photo": iso in photo_days, "quests_done": quest_days.get(iso, 0),
                       "complete": total > 0 and dd["planned"] == 0})
        d += timedelta(days=1)
    return {"month": month, "days": result, "today": _today(user_id).isoformat()}


# ==================== ИЗМЕНЕНИЕ ====================
def create_plan(user_id: int, data: dict) -> dict:
    today = _today(user_id)
    f = _clean(data, today, partial=False)
    if f["remind"] != "none" and not f["time"]:
        f["remind"] = "none"
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM plans WHERE user_id = ? AND status = 'planned'", (user_id,)).fetchone()[0]
    if n >= PLANS_LIMIT:
        conn.close()
        raise game.QuestError("Планов уже очень много — отпусти или выполни часть старых 🙂")
    cols = ["user_id", "created_at"] + list(f.keys())
    cur = conn.execute(f"INSERT INTO plans ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                       [user_id, storage.utc_now_str(), *f.values()])
    conn.commit()
    plan_id = cur.lastrowid
    conn.close()
    return occurrence(user_id, plan_id, first_occurrence(_get(user_id, plan_id)))


def update_plan(user_id: int, plan_id: int, data: dict) -> dict:
    plan = _get(user_id, plan_id)
    f = _clean(data, _today(user_id), partial=True)
    if f.get("remind", plan["remind"]) != "none" and not f.get("time", plan["time"]):
        f["remind"] = "none"
    if f:
        conn = storage.connect()
        conn.execute(f"UPDATE plans SET {', '.join(f'{k} = ?' for k in f)} WHERE id = ? AND user_id = ?",
                     (*f.values(), plan_id, user_id))
        conn.commit()
        conn.close()
    plan = _get(user_id, plan_id)
    d = parse_date(data["occurrence"]) if data.get("occurrence") else date.fromisoformat(plan["date"])
    if not occurs_on(plan, d):
        d = first_occurrence(plan)
    if (plan["repeat_rule"] or "none") == "none":
        # у разового плана фото привязаны к его дате — переезжают вместе с ним
        conn = storage.connect()
        conn.execute("UPDATE photos SET plan_date = ? WHERE plan_id = ?", (plan["date"], plan_id))
        conn.commit()
        conn.close()
    return occurrence(user_id, plan_id, d)


def _set_occurrence_status(plan: dict, d: date, status: str):
    conn = storage.connect()
    if (plan["repeat_rule"] or "none") == "none":
        conn.execute("UPDATE plans SET status = ?, done_at = ? WHERE id = ?",
                     (status, storage.utc_now_str() if status == "done" else None, plan["id"]))
    else:
        conn.execute("""INSERT INTO plan_exceptions (plan_id, date, status, done_at) VALUES (?, ?, ?, ?)
                        ON CONFLICT(plan_id, date) DO UPDATE SET status = excluded.status, done_at = excluded.done_at""",
                     (plan["id"], d.isoformat(), status, storage.utc_now_str() if status == "done" else None))
    conn.commit()
    conn.close()


def _resolve(user_id: int, plan_id: int, day) -> tuple:
    plan = _get(user_id, plan_id)
    d = parse_date(day) if day else first_occurrence(plan)
    if not occurs_on(plan, d):
        raise game.QuestError("В этот день плана нет")
    return plan, d


def complete_plan(user_id: int, plan_id: int, day=None) -> dict:
    """Отметить план выполненным. Задание из банка проходит через общий
    сервис game: принимается (если ещё не принято) и выполняется."""
    plan, d = _resolve(user_id, plan_id, day)
    current = occurrence(user_id, plan_id, d)
    if current["status"] == "done":
        raise game.QuestError("Этот план уже выполнен")
    if d > _today(user_id):
        raise game.QuestError("Этот день ещё не наступил — отметить можно в свой день или позже")
    result = {"xp": 0, "breakdown": [], "level_up": None, "new_achievements": [], "used_freeze": False}
    if plan["quest_key"] and plan["quest_key"] in CATALOG:
        acc = game.accept_quest(user_id, plan["quest_key"], plan["tier"])
        done = game.complete_quest(user_id, acc["active_id"])
        if done:
            result = done
    else:
        reason = f"plan:{plan_id}:{d.isoformat()}"
        conn = storage.connect()
        already = conn.execute("SELECT 1 FROM xp_log WHERE user_id = ? AND reason = ?", (user_id, reason)).fetchone()
        conn.close()
        if not already:
            user = storage.get_user(user_id)
            before = game.level_for_xp(user.get("xp") or 0)
            game.add_xp(user_id, FREE_PLAN_XP, reason, _today(user_id).isoformat())
            total = (user.get("xp") or 0) + FREE_PLAN_XP
            result.update(xp=FREE_PLAN_XP, breakdown=[{"label": "План", "xp": FREE_PLAN_XP}],
                          level_up=game.level_info(total) if game.level_for_xp(total) > before else None)
    _set_occurrence_status(plan, d, "done")
    # План, привязанный к клетке карты недели, закрывает и клетку.
    if plan["board_cell"] is not None and plan["board_week"] == storage.get_current_week_key(_today(user_id)):
        board = storage.get_weekly_board(user_id, _today(user_id))
        if board["cells"][plan["board_cell"]].strip():
            board["done"][plan["board_cell"]] = True
            b = game.save_board(user_id, board)
            result["xp"] = result.get("xp", 0) + b["xp"]
            result["new_achievements"] = (result.get("new_achievements") or []) + b["new_achievements"]
    result["new_achievements"] = (result.get("new_achievements") or []) + game.check_achievements(user_id)
    result["plan"] = occurrence(user_id, plan_id, d)
    return result


def skip_plan(user_id: int, plan_id: int, day=None) -> dict:
    """«Отпустить» — без упрёков: день просто снимается с плана."""
    plan, d = _resolve(user_id, plan_id, day)
    _set_occurrence_status(plan, d, "skipped")
    return {"plan": occurrence(user_id, plan_id, d)}


def move_plan(user_id: int, plan_id: int, day, new_day) -> dict:
    plan, d = _resolve(user_id, plan_id, day)
    nd = parse_date(new_day, "новая дата")
    _check_window(nd, _today(user_id))
    if (plan["repeat_rule"] or "none") == "none":
        conn = storage.connect()
        conn.execute("UPDATE plans SET date = ?, status = 'planned', done_at = NULL WHERE id = ?", (nd.isoformat(), plan_id))
        conn.execute("UPDATE photos SET plan_date = ? WHERE plan_id = ?", (nd.isoformat(), plan_id))
        conn.execute("DELETE FROM plan_reminders WHERE plan_id = ?", (plan_id,))
        conn.commit()
        conn.close()
        return {"plan": occurrence(user_id, plan_id, nd)}
    # День из серии переезжает отдельным разовым планом.
    _set_occurrence_status(plan, d, "moved")
    copy = {k: plan[k] for k in ("title", "note", "time", "color", "remind", "quest_key", "tier")}
    copy.update(date=nd.isoformat(), repeat_rule="none")
    return {"plan": create_plan(user_id, copy)}


def delete_plan(user_id: int, plan_id: int, day=None, whole: bool = True) -> dict:
    plan = _get(user_id, plan_id)
    if not whole and day and (plan["repeat_rule"] or "none") != "none":
        d = parse_date(day)
        _set_occurrence_status(plan, d, "skipped")
        import photos as photos_mod
        photos_mod.delete_where(user_id, "plan_id = ? AND plan_date = ?", (plan_id, d.isoformat()))
        return {"ok": True}
    import photos as photos_mod
    photos_mod.delete_where(user_id, "plan_id = ?", (plan_id,))
    conn = storage.connect()
    conn.execute("DELETE FROM plan_exceptions WHERE plan_id = ?", (plan_id,))
    conn.execute("DELETE FROM plan_reminders WHERE plan_id = ?", (plan_id,))
    conn.execute("DELETE FROM plans WHERE id = ? AND user_id = ?", (plan_id, user_id))
    conn.commit()
    conn.close()
    return {"ok": True}


# ==================== НАПОМИНАНИЯ ====================
REMIND_WINDOW_MIN = 15


def due_reminders(now_utc: datetime = None) -> list:
    """Что пора напомнить: [(user_id, occurrence)]. Время плана — местное
    время пользователя; уже отправленное помечается в plan_reminders."""
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT p.*, u.tz FROM plans p JOIN users u ON u.user_id = p.user_id
                           WHERE p.remind <> 'none' AND p.time IS NOT NULL""").fetchall()
    sent = {(r[0], r[1]) for r in conn.execute("SELECT plan_id, date FROM plan_reminders").fetchall()}
    conn.close()
    result = []
    for r in rows:
        plan = dict(r)
        now = game.local_now({"tz": plan["tz"]}) if now_utc is None else _to_local(now_utc, plan["tz"])
        hh, mm = map(int, plan["time"].split(":"))
        for d in (now.date(), now.date() + timedelta(days=1)):
            if not occurs_on(plan, d) or (plan["id"], d.isoformat()) in sent:
                continue
            at = datetime(d.year, d.month, d.day, hh, mm)
            if plan["remind"] == "hour_before":
                at -= timedelta(hours=1)
            if at <= now < at + timedelta(minutes=REMIND_WINDOW_MIN):
                occ = occurrence(plan["user_id"], plan["id"], d)
                if occ["status"] == "planned":
                    result.append((plan["user_id"], occ))
    return result


def _to_local(now_utc: datetime, tz: str) -> datetime:
    if tz and game.valid_tz(tz):
        from zoneinfo import ZoneInfo
        return now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(tz)).replace(tzinfo=None)
    return now_utc


def mark_reminded(plan_id: int, day: str):
    conn = storage.connect()
    conn.execute("INSERT OR IGNORE INTO plan_reminders (plan_id, date, sent_at) VALUES (?, ?, ?)",
                 (plan_id, day, storage.utc_now_str()))
    conn.commit()
    conn.close()


# ==================== ЭКСПОРТ .ICS ====================
def _ics_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545: строки длиннее 75 октетов переносятся с пробелом."""
    out, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > 73:
            out.append(cur.decode("utf-8"))
            cur = b" " + b
        else:
            cur += b
    out.append(cur.decode("utf-8"))
    return "\r\n".join(out)


def export_ics(user_id: int, start: date, end: date) -> str:
    items = [o for o in occurrences(user_id, start, end) if o["status"] in ("planned", "done")]
    tz = storage.get_user(user_id).get("tz") or ""
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LifeQuest//Calendar//RU", "CALSCALE:GREGORIAN",
             "X-WR-CALNAME:LifeQuest"]
    if tz:
        lines.append(f"X-WR-TIMEZONE:{tz}")
    for o in items:
        d = o["date"].replace("-", "")
        lines += ["BEGIN:VEVENT", f"UID:lifequest-{o['id']}-{d}@lifequest", f"DTSTAMP:{stamp}"]
        if o["time"]:
            start_t = f"{d}T{o['time'].replace(':', '')}00"
            end_dt = datetime.strptime(start_t, "%Y%m%dT%H%M%S") + timedelta(hours=1)
            tzid = f";TZID={tz}" if tz else ""
            lines += [f"DTSTART{tzid}:{start_t}", f"DTEND{tzid}:{end_dt.strftime('%Y%m%dT%H%M%S')}"]
        else:
            nxt = (date.fromisoformat(o["date"]) + timedelta(days=1)).strftime("%Y%m%d")
            lines += [f"DTSTART;VALUE=DATE:{d}", f"DTEND;VALUE=DATE:{nxt}"]
        emoji = o["quest"]["emoji"] + " " if o["quest"] else ""
        desc = o["note"] or (o["quest"]["text"] if o["quest"] else "")
        lines += [f"SUMMARY:{_ics_escape(emoji + o['title'])}", f"DESCRIPTION:{_ics_escape(desc)}"]
        if o["remind"] != "none" and o["time"]:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_escape(o['title'])}",
                      f"TRIGGER:{'-PT1H' if o['remind'] == 'hour_before' else 'PT0M'}", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"

"""Сводка о новых пользователях — только для владелицы бота (ADMIN_ID).

/new [дней] — кто пришёл за последние N дней (по умолчанию 7): итоги, по дням
и карточка каждого — откуда пришёл, открыл ли приложение, что успел сделать.
Каждое утро — то же самое за вчера, если новенькие были (daily_digest).

Время показывается в часовом поясе владелицы (из её профиля, иначе Москва)."""

import html
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import game
import storage

MAX_CARDS = 40          # карточек в одной сводке; остальные — одной строкой
CHUNK = 3800            # лимит Telegram — 4096 символов на сообщение
DIGEST_HOUR = 10        # утренняя сводка за вчера — в 10:00 по времени владелицы
DEFAULT_TZ = "Europe/Moscow"

WD = ("пн", "вт", "ср", "чт", "пт", "сб", "вс")


def _tz(admin_id: int) -> ZoneInfo:
    user = storage.get_user(admin_id) or {}
    tz = user.get("tz")
    return ZoneInfo(tz if tz and game.valid_tz(tz) else DEFAULT_TZ)


def _parse(ts: str):
    if not ts:
        return None
    try:
        return datetime.strptime(str(ts)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("UTC"))
    except ValueError:
        return None


def _local(ts: str, tz: ZoneInfo):
    dt = _parse(ts)
    return dt.astimezone(tz) if dt else None


def _ago(dt, now) -> str:
    if not dt:
        return "ни разу"
    sec = max(0, (now - dt).total_seconds())
    if sec < 3600:
        return f"{int(sec // 60)} мин назад"
    if sec < 86400:
        return f"{int(sec // 3600)} ч назад"
    return f"{int(sec // 86400)} дн назад"


def _count(conn, sql: str, uid: int) -> int:
    try:
        return conn.execute(sql, (uid,)).fetchone()[0] or 0
    except Exception:  # таблицы может не быть на старой базе
        return 0


ACTIVITY = {
    "quests": "SELECT COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'",
    "quests_taken": "SELECT COUNT(*) FROM quest_history WHERE user_id = ?",
    "habits": "SELECT COUNT(*) FROM habits WHERE user_id = ?",
    "habit_marks": "SELECT COUNT(*) FROM habit_logs WHERE user_id = ? AND done = 1",
    "plans": "SELECT COUNT(*) FROM plans WHERE user_id = ?",
    "notes": "SELECT COUNT(*) FROM notes WHERE user_id = ?",
    "photos": "SELECT COUNT(*) FROM photos WHERE user_id = ?",
    "friends": "SELECT COUNT(*) FROM friends WHERE user_id = ?",
    "duels": "SELECT COUNT(*) FROM habit_duels WHERE creator_id = ?1 OR opponent_id = ?1",
    "contests": "SELECT COUNT(*) FROM contest_members WHERE user_id = ?",
    "board": "SELECT COUNT(*) FROM weekly_boards WHERE user_id = ?",
    "payments": "SELECT COUNT(*) FROM payments WHERE user_id = ? AND refunded = 0",
}


def _activity(conn, uid: int) -> dict:
    return {k: _count(conn, sql, uid) for k, sql in ACTIVITY.items()}


def _status(u: dict, a: dict) -> tuple:
    """(эмодзи, подпись) — насколько человек втянулся."""
    if u.get("blocked"):
        return "⛔", "заблокировал(а) бота"
    did = a["quests"] + a["habit_marks"] + a["plans"] + a["photos"] + a["notes"] + a["duels"] + a["contests"]
    if did >= 5:
        return "🔥", "активный"
    if did:
        return "🟢", "начал(а) пользоваться"
    if u.get("onboarded") or u.get("last_seen_at") or a["habits"]:
        return "🟡", "открыл(а) приложение, пока ничего не сделал(а)"
    return "⚪", "только нажал(а) «Старт»"


def _name(u: dict) -> str:
    return u.get("first_name") or u.get("username") or f"id {u['user_id']}"


def collect(days: int, admin_id: int, now: datetime = None) -> dict:
    """Новые пользователи за последние `days` дней (по времени владелицы, включая сегодня)."""
    tz = _tz(admin_id)
    now = now or datetime.now(ZoneInfo("UTC"))
    local_now = now.astimezone(tz)
    start_local = (local_now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return _collect_range(start_local, local_now, admin_id, tz, now)


def collect_day(day_local, admin_id: int, now: datetime = None) -> dict:
    """Новые пользователи за конкретный день (дата по времени владелицы)."""
    tz = _tz(admin_id)
    now = now or datetime.now(ZoneInfo("UTC"))
    start = datetime(day_local.year, day_local.month, day_local.day, tzinfo=tz)
    return _collect_range(start, start + timedelta(days=1) - timedelta(seconds=1), admin_id, tz, now)


def _collect_range(start_local, end_local, admin_id, tz, now) -> dict:
    s = start_local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S")
    e = end_local.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S")
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM users WHERE created_at >= ? AND created_at <= ? AND user_id != ? ORDER BY created_at DESC",
        (s, e, admin_id)).fetchall()]
    total = conn.execute("SELECT COUNT(*) FROM users WHERE user_id != ?", (admin_id,)).fetchone()[0]
    people = []
    for u in rows:
        a = _activity(conn, u["user_id"])
        inviter = None
        if u.get("referred_by"):
            inv = conn.execute("SELECT * FROM users WHERE user_id = ?", (u["referred_by"],)).fetchone()
            inviter = _name(dict(inv)) if inv else f"id {u['referred_by']}"
        people.append({"user": u, "act": a, "inviter": inviter, "status": _status(u, a)})
    conn.close()
    return {"start": start_local, "end": end_local, "tz": tz, "now": now, "people": people, "total": total}


def _plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(n) % 100
    if 11 <= n <= 19:
        return many
    n %= 10
    return one if n == 1 else few if 2 <= n <= 4 else many


def render(data: dict, title: str) -> list:
    """Готовые сообщения (HTML), каждое — не длиннее лимита Telegram."""
    people, tz, now = data["people"], data["tz"], data["now"]
    n = len(people)
    head = [f"👋 <b>{html.escape(title)}</b>",
            f"{data['start']:%d.%m} — {data['end']:%d.%m}, время — {html.escape(str(tz))}", ""]
    if not n:
        head.append("Новых пользователей нет.")
        head.append(f"Всего в боте: {data['total']}.")
        return ["\n".join(head)]

    by_status = {}
    for p in people:
        by_status.setdefault(p["status"][0], 0)
        by_status[p["status"][0]] += 1
    invited = sum(1 for p in people if p["inviter"])
    premium = sum(1 for p in people if game.is_premium(p["user"]) or p["user"].get("trial_used"))
    paid = sum(1 for p in people if p["act"]["payments"])
    head += [f"Новых: <b>{n}</b> (всего в боте: {data['total']})",
             f"🔥 активных: {by_status.get('🔥', 0)} · 🟢 начали: {by_status.get('🟢', 0)} · "
             f"🟡 только открыли: {by_status.get('🟡', 0)} · ⚪ только «Старт»: {by_status.get('⚪', 0)} · "
             f"⛔ заблокировали: {by_status.get('⛔', 0)}",
             f"🤝 по приглашению друга: {invited} · сами: {n - invited}"]
    if premium or paid:
        head.append(f"👑 Premium/пробный: {premium} · 💳 оплатили: {paid}")

    # по дням
    days = {}
    for p in people:
        d = _local(p["user"]["created_at"], tz)
        if d:
            days.setdefault(d.date(), 0)
            days[d.date()] += 1
    if len(days) > 1:
        head += ["", "<b>По дням</b>"]
        for d in sorted(days, reverse=True):
            head.append(f"{d:%d.%m} {WD[d.weekday()]} — {days[d]}")

    # откуда приходят
    inviters = {}
    for p in people:
        if p["inviter"]:
            inviters[p["inviter"]] = inviters.get(p["inviter"], 0) + 1
    if inviters:
        top = sorted(inviters.items(), key=lambda x: -x[1])[:5]
        head += ["", "<b>Кто больше всех привёл</b>"] + [f"{html.escape(k)} — {v}" for k, v in top]

    cards = []
    for p in people[:MAX_CARDS]:
        u, a = p["user"], p["act"]
        joined = _local(u["created_at"], tz)
        seen = _local(u.get("last_seen_at"), tz)
        lv = game.level_info(u.get("xp") or 0)
        uname = f" @{html.escape(u['username'])}" if u.get("username") else ""
        lines = [f"{p['status'][0]} <b>{html.escape(_name(u))}</b>{uname} · <code>{u['user_id']}</code>",
                 f"   пришёл(а): {joined:%d.%m %H:%M}" + (f" · по приглашению: {html.escape(p['inviter'])}" if p["inviter"] else " · сам"),
                 f"   {p['status'][1]} · был(а) в приложении: {_ago(seen.astimezone(ZoneInfo('UTC')) if seen else None, now)}"]
        did = []
        if a["quests_taken"]:
            did.append(f"квесты {a['quests']}/{a['quests_taken']}")
        if a["habits"]:
            did.append(f"привычки {a['habits']} (отметок {a['habit_marks']})")
        for key, label in (("plans", "планы"), ("notes", "заметки"), ("photos", "фото"), ("friends", "друзья"),
                           ("duels", "дуэли"), ("contests", "соревнования")):
            if a[key]:
                did.append(f"{label} {a[key]}")
        if did:
            lines.append("   " + " · ".join(did))
        extra = [f"ур. {lv['level']}, {u.get('xp') or 0} XP"]
        if u.get("tz"):
            extra.append(html.escape(u["tz"]))
        if game.is_premium(u):
            extra.append("👑 Premium")
        elif u.get("trial_used"):
            extra.append("пробовал Premium")
        if a["payments"]:
            extra.append(f"💳 оплат: {a['payments']}")
        lines.append("   " + " · ".join(extra))
        cards.append("\n".join(lines))
    if n > MAX_CARDS:
        cards.append(f"…и ещё {n - MAX_CARDS} {_plural(n - MAX_CARDS, 'человек', 'человека', 'человек')}")

    # склеиваем в сообщения не длиннее лимита
    out, cur = [], "\n".join(head) + "\n\n<b>Кто пришёл</b>"
    for c in cards:
        if len(cur) + len(c) + 2 > CHUNK:
            out.append(cur)
            cur = c
        else:
            cur += "\n\n" + c
    out.append(cur)
    return out


def report(days: int, admin_id: int, now: datetime = None) -> list:
    days = max(1, min(int(days or 7), 365))
    title = "Новые пользователи сегодня" if days == 1 else f"Новые пользователи за {days} {_plural(days, 'день', 'дня', 'дней')}"
    return render(collect(days, admin_id, now), title)


def daily_digest(admin_id: int, now: datetime = None) -> list:
    """Утром по времени владелицы: новенькие за вчера. Пусто — если никого не было
    или сводка за этот день уже отправлена."""
    if not admin_id or not storage.get_user(admin_id):
        return []
    tz = _tz(admin_id)
    now = now or datetime.now(ZoneInfo("UTC"))
    local = now.astimezone(tz)
    if local.hour != DIGEST_HOUR:
        return []
    yesterday = (local - timedelta(days=1)).date()
    key = f"new_users_digest:{yesterday.isoformat()}"
    conn = storage.connect()
    seen = conn.execute("SELECT 1 FROM meta WHERE key = ?", (key,)).fetchone()
    if not seen:
        conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", (key, storage.utc_now_str()))
        conn.commit()
    conn.close()
    if seen:
        return []
    data = collect_day(yesterday, admin_id, now)
    if not data["people"]:
        return []
    return render(data, f"Новые пользователи за вчера, {yesterday:%d.%m}")

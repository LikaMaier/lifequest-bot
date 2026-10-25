"""Отчёт для владелицы (ADMIN_ID): кто из пользователей что делал за день.

/activity — сегодня, /activity 1 — вчера, /activity N — N дней назад.
Каждое утро в 10:00 по времени владелицы — то же самое за вчера (daily_digest).

По каждому человеку: когда заходил(а) в приложение, отмеченные привычки, квесты,
планы, заметки, фото, настроение, друзья, дуэли, соревнования, покупки и XP.
Владелица в отчёт не попадает."""

import html
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import admin_report
import challenges
import game
import storage

MAX_TITLES = 5
TITLE_LEN = 40
MOOD_EMOJI = {"sad": "😔", "ok": "😐", "good": "🙂", "great": "🤩"}


def _item_names() -> dict:
    names = {a[0]: a[1] for a in (*game.ACCESSORIES, *game.SEASONAL_ACCESSORIES, *game.PREMIUM_ACCESSORIES)}
    names.update({f"theme:{k}": f"стиль «{n}»" for k, n, _d in game.THEMES})
    return names


def _titles(items) -> str:
    items = [html.escape(str(t or "").strip()[:TITLE_LEN]) or "без названия" for t in items]
    shown = ", ".join(f"«{t}»" for t in items[:MAX_TITLES])
    return shown + (f" и ещё {len(items) - MAX_TITLES}" if len(items) > MAX_TITLES else "")


def _rows(conn, sql: str, args) -> list:
    try:
        return conn.execute(sql, args).fetchall()
    except Exception:  # таблицы может не быть на старой базе
        return []


def collect_day(day, admin_id: int) -> dict:
    """{user_id: {...}} — всё, что люди сделали за день `day` (дата по времени владелицы)."""
    tz = admin_report._tz(admin_id)
    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    s = start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S")
    e = (start + timedelta(days=1)).astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d %H:%M:%S")
    d = day.isoformat()
    span = (s, e)
    conn = storage.connect()
    acts = {}

    def add(uid, key, value=None):
        if uid == admin_id:
            return
        a = acts.setdefault(uid, {})
        if value is None:
            a[key] = a.get(key, 0) + 1
        else:
            a.setdefault(key, []).append(value)

    for uid, emoji, title in _rows(conn, """SELECT l.user_id, h.emoji, h.title FROM habit_logs l JOIN habits h ON h.id = l.habit_id
                                            WHERE l.local_date = ? AND l.done = 1""", (d,)):
        add(uid, "habits_done", f"{emoji or ''} {title}".strip())
    for uid, title in _rows(conn, "SELECT user_id, title FROM habits WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "habits_new", title)
    for uid, title in _rows(conn, "SELECT user_id, title FROM quest_history WHERE completed_at >= ? AND completed_at < ?", span):
        add(uid, "quests_done", title)
    for uid, title in _rows(conn, """SELECT user_id, title FROM quest_history WHERE accepted_at >= ? AND accepted_at < ?
                                     AND (completed_at IS NULL OR completed_at >= ?)""", (s, e, e)):
        add(uid, "quests_taken", title)
    for uid, in _rows(conn, "SELECT user_id FROM quest_history WHERE skipped_at >= ? AND skipped_at < ?", span):
        add(uid, "quests_skipped")
    for uid, title in _rows(conn, "SELECT user_id, title FROM plans WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "plans_new", title)
    for uid, title in _rows(conn, "SELECT user_id, title FROM plans WHERE done_at >= ? AND done_at < ?", span):
        add(uid, "plans_done", title)
    for uid, title in _rows(conn, """SELECT p.user_id, p.title FROM plan_exceptions x JOIN plans p ON p.id = x.plan_id
                                     WHERE x.status = 'done' AND x.done_at >= ? AND x.done_at < ?""", span):
        add(uid, "plans_done", title)
    for uid, in _rows(conn, "SELECT user_id FROM notes WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "notes")
    for uid, in _rows(conn, "SELECT user_id FROM photos WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "photos")
    for uid, mood in _rows(conn, "SELECT user_id, mood FROM day_moods WHERE updated_at >= ? AND updated_at < ?", span):
        add(uid, "moods", MOOD_EMOJI.get(mood, mood))
    for uid, in _rows(conn, "SELECT user_id FROM friends WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "friends")
    for uid, title in _rows(conn, "SELECT creator_id, title FROM habit_duels WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "duels", title)
    for uid, title in _rows(conn, "SELECT creator_id, title FROM contests WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "contests_new", title)
    for uid, title in _rows(conn, """SELECT m.user_id, c.title FROM contest_members m JOIN contests c ON c.id = m.contest_id
                                     WHERE m.joined_at >= ? AND m.joined_at < ? AND m.user_id != c.creator_id""", span):
        add(uid, "contests_joined", title)
    for uid, cid in _rows(conn, "SELECT user_id, challenge_id FROM user_challenges WHERE started_at >= ? AND started_at < ?", span):
        c = challenges.BY_ID.get(cid)
        add(uid, "challenges", c[2] if c else cid)
    names = _item_names()
    for uid, item in _rows(conn, "SELECT user_id, item FROM purchases WHERE created_at >= ? AND created_at < ?", span):
        add(uid, "purchases", names.get(item, item))
    for uid, product, amount, cur in _rows(conn, """SELECT user_id, product, stars, COALESCE(currency, 'XTR') FROM payments
                                                    WHERE created_at >= ? AND created_at < ? AND refunded = 0""", span):
        add(uid, "payments", f"{product} — {amount // 100} ₽" if cur == "RUB" else f"{product} — {amount}⭐")
    xp = {uid: n for uid, n in _rows(conn, "SELECT user_id, SUM(amount) FROM xp_log WHERE local_date = ? GROUP BY user_id", (d,))}
    seen = {uid: ts for uid, ts in _rows(conn, "SELECT user_id, last_seen_at FROM users WHERE last_seen_at >= ? AND last_seen_at < ?", span)}
    for uid in seen:
        if uid != admin_id:
            acts.setdefault(uid, {})
    users = {}
    for uid in acts:
        row = conn.execute("SELECT user_id, first_name, username, created_at FROM users WHERE user_id = ?", (uid,)).fetchone()
        users[uid] = {"user_id": uid, "first_name": row[1], "username": row[2], "created_at": row[3]} if row else {"user_id": uid}
    conn.close()
    return {"day": day, "tz": tz, "start": s, "end": e, "acts": acts, "xp": xp, "seen": seen, "users": users}



def _card(data: dict, uid: int) -> str:
    a, u, tz = data["acts"][uid], data["users"][uid], data["tz"]
    name = html.escape(u.get("first_name") or u.get("username") or f"id {uid}")
    uname = f" @{html.escape(u['username'])}" if u.get("username") else ""
    new = " 🆕" if u.get("created_at") and data["start"] <= str(u["created_at"]) < data["end"] else ""
    head = f"<b>{name}</b>{uname}{new} · <code>{uid}</code>"
    seen = admin_report._local(data["seen"].get(uid), tz)
    if seen:
        head += f" · был(а) в {seen:%H:%M}"
    if data["xp"].get(uid):
        head += f" · +{data['xp'][uid]} XP"
    lines = [head]

    def line(icon, label, key):
        if a.get(key):
            lines.append(f"   {icon} {label}: {_titles(a[key])}")

    line("✅", "привычки", "habits_done")
    line("🌱", "новые привычки", "habits_new")
    line("🎯", "выполнил(а) квесты", "quests_done")
    line("🎲", "взял(а) квесты", "quests_taken")
    line("🗓️", "добавил(а) планы", "plans_new")
    line("☑️", "сделал(а) планы", "plans_done")
    line("⚔️", "вызвал(а) на дуэль", "duels")
    line("🏆", "создал(а) соревнование", "contests_new")
    line("🤝", "вступил(а) в соревнование", "contests_joined")
    line("🚀", "начал(а) челлендж", "challenges")
    line("🛍️", "купил(а) в магазине", "purchases")
    small = []
    if a.get("quests_skipped"):
        small.append(f"⏭️ пропустил(а) квестов: {a['quests_skipped']}")
    if a.get("notes"):
        small.append(f"📝 заметок: {a['notes']}")
    if a.get("photos"):
        small.append(f"📸 фото: {a['photos']}")
    if a.get("moods"):
        small.append(f"настроение: {' '.join(a['moods'])}")
    if a.get("friends"):
        small.append(f"👥 новых друзей: {a['friends']}")
    if small:
        lines.append("   " + " · ".join(small))
    if a.get("payments"):
        lines.append(f"   💳 оплата: {html.escape(', '.join(a['payments']))}")
    return "\n".join(lines)


def render(data: dict, title: str) -> list:
    """Готовые HTML-сообщения не длиннее лимита Telegram."""
    day = data["day"]
    head = [f"📋 <b>{html.escape(title)}</b>",
            f"{day:%d.%m} {admin_report.WD[day.weekday()]}, время — {html.escape(str(data['tz']))}", ""]
    doers = [uid for uid, a in data["acts"].items() if a]
    only_seen = [uid for uid, a in data["acts"].items() if not a]
    if not data["acts"]:
        head.append("Сегодня в приложении никого не было." if title.startswith("Активность сегодня")
                    else "В этот день в приложении никого не было.")
        return ["\n".join(head)]
    head.append(f"Что-то делали: <b>{len(doers)}</b> · только заходили: {len(only_seen)}")
    # сначала самые активные
    doers.sort(key=lambda uid: (-(data["xp"].get(uid) or 0), -sum(len(v) if isinstance(v, list) else v
                                                                  for v in data["acts"][uid].values())))
    cards = [_card(data, uid) for uid in doers]
    if only_seen:
        names = []
        for uid in only_seen:
            u = data["users"][uid]
            seen = admin_report._local(data["seen"].get(uid), data["tz"])
            names.append(f"{html.escape(u.get('first_name') or u.get('username') or str(uid))}"
                         + (f" ({seen:%H:%M})" if seen else ""))
        cards.append("👀 <b>Только заходили:</b> " + ", ".join(names))
    out, cur = [], "\n".join(head)
    for c in cards:
        if len(cur) + len(c) + 2 > admin_report.CHUNK:
            out.append(cur)
            cur = c
        else:
            cur += "\n\n" + c
    out.append(cur)
    return out


def report(days_ago: int, admin_id: int, now: datetime = None) -> list:
    days_ago = max(0, min(int(days_ago or 0), 365))
    now = now or datetime.now(ZoneInfo("UTC"))
    day = (now.astimezone(admin_report._tz(admin_id)) - timedelta(days=days_ago)).date()
    title = {0: "Активность сегодня", 1: "Активность за вчера"}.get(days_ago, "Активность")
    return render(collect_day(day, admin_id), title)


def daily_digest(admin_id: int, now: datetime = None) -> list:
    """В 10:00 по времени владелицы — активность за вчера (один раз за день)."""
    if not admin_id or not storage.get_user(admin_id):
        return []
    now = now or datetime.now(ZoneInfo("UTC"))
    local = now.astimezone(admin_report._tz(admin_id))
    if local.hour != admin_report.DIGEST_HOUR:
        return []
    yesterday = (local - timedelta(days=1)).date()
    key = f"activity_digest:{yesterday.isoformat()}"
    conn = storage.connect()
    seen = conn.execute("SELECT 1 FROM meta WHERE key = ?", (key,)).fetchone()
    if not seen:
        conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", (key, storage.utc_now_str()))
        conn.commit()
    conn.close()
    if seen:
        return []
    return render(collect_day(yesterday, admin_id), "Активность за вчера")

"""Друзья — живое общение: лента событий с реакциями, «подбодрить / пнуть»
и квест вдвоём (одно задание на двоих — засчитывается, когда сделали оба).

Лента собирается на лету из quest_history, серий и давности захода друзей —
отдельных таблиц событий нет. Реакции и пинки хранятся, чтобы не спамить."""

import html
import random
from datetime import date, datetime, timedelta

import game
import photos
import storage
from quests_database import CATALOG

REACTIONS = ("🔥", "👏", "😂", "💜")
FEED_DAYS = 7
FEED_LIMIT = 30
PAIR_BONUS_XP = 20  # каждому, когда квест вдвоём закрыли оба

CHEER_LINES = [
    "{who} машет тебе лапкой: «Ты справишься, я в тебя верю!» 🐾",
    "{who} передаёт: «Один шаг сегодня — и ты уже впереди вчерашнего себя» ✨",
    "{who} шлёт обнимашки и напоминает: серия ждёт тебя 💜",
    "От {who}: «Не идеально — зато сделано. Вперёд!» 🙌",
]
POKE_LINES = [
    "{who} пинает тебя мягкой лапой: где галочки? 👉",
    "{who} спрашивает: «Ты там живой? Маскот уже пыль собирает» 🕸️",
    "{who} шлёт тебе будильник ⏰ — одна привычка, и можно дальше лениться.",
    "{who}: «Пока ты думаешь, я уже сделал квест. Догоняй!» 🏃",
]


def ensure_tables():
    c = storage.connect()
    c.execute("""CREATE TABLE IF NOT EXISTS feed_reactions (
        event_id TEXT NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, created_at TEXT,
        PRIMARY KEY (event_id, user_id))""")
    c.execute("""CREATE TABLE IF NOT EXISTS friend_pings (
        user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY (user_id, friend_id, date, kind))""")
    c.execute("""CREATE TABLE IF NOT EXISTS pair_quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER NOT NULL, friend_id INTEGER NOT NULL,
        quest_key TEXT NOT NULL, title TEXT, emoji TEXT, text TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        creator_done INTEGER DEFAULT 0, friend_done INTEGER DEFAULT 0,
        created_at TEXT, finished_at TEXT)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_pair_quests_users ON pair_quests(creator_id, friend_id, status)")
    c.commit()
    c.close()


def _friend_ids(conn, user_id: int) -> list:
    return [r[0] for r in conn.execute("SELECT friend_id FROM friends WHERE user_id = ?", (user_id,)).fetchall()]


def _name(user: dict) -> str:
    return user.get("first_name") or user.get("username") or "Друг"


def _public(user: dict) -> dict:
    return {"id": user["user_id"], "name": _name(user),
            "mascot": game.LEGACY_MASCOTS.get(user.get("mascot"), user.get("mascot")) or "cat-purple",
            "accessory": game.visible_accessory(user)}


def _days_since(ts: str, today: date) -> int:
    if not ts:
        return 99
    try:
        return (today - datetime.fromisoformat(ts.replace("Z", "")).date()).days
    except ValueError:
        return 99


# ---------- лента ----------
def feed(user_id: int) -> dict:
    ensure_tables()
    me = storage.get_user(user_id)
    today = game.local_today(me)
    since = (today - timedelta(days=FEED_DAYS)).isoformat()
    conn = storage.connect(rows=True)
    ids = _friend_ids(conn, user_id)
    events = []
    for fid in ids:
        fu = storage.get_user(fid)
        if not fu:
            continue
        pub = _public(fu)
        # выполненные квесты
        qrows = conn.execute("""SELECT id, quest_key, title, completed_at, local_date FROM quest_history
                                WHERE user_id = ? AND status = 'done' AND local_date >= ?
                                ORDER BY completed_at DESC LIMIT 5""", (fid, since)).fetchall()
        shared = photos.quest_photos_shared(fid, [r["id"] for r in qrows])
        for r in qrows:
            q = CATALOG.get(r["quest_key"]) or {}
            events.append({"id": f"q:{fid}:{r['id']}", "kind": "quest", "friend": pub, "date": r["local_date"],
                           "at": r["completed_at"], "emoji": q.get("emoji") or "🎯",
                           "title": r["title"] or q.get("title") or "квест",
                           "text": f"{pub['name']} сделал(а) квест", "photos": shared.get(r["id"], [])})
        # серия — круглые отметки
        s = game.user_streak(fu, game.local_today(fu))
        if s["current"] >= 3 and s["status"] == "done" and (s["current"] % 7 == 0 or s["current"] in (3, 5, 10)):
            events.append({"id": f"s:{fid}:{s['current']}:{today.isoformat()}", "kind": "streak", "friend": pub,
                           "date": today.isoformat(), "at": storage.utc_now_str(), "emoji": "🔥",
                           "title": f"серия {s['current']} дн.", "text": f"{pub['name']} держит серию", "streak": s["current"]})
        # давно не заходил — повод подбодрить или пнуть
        away = _days_since(fu.get("last_seen_at"), today)
        if away >= 2:
            events.append({"id": f"a:{fid}:{today.isoformat()}", "kind": "away", "friend": pub, "date": today.isoformat(),
                           "at": (datetime.utcnow() - timedelta(days=away)).isoformat(), "emoji": "💤",
                           "title": f"не заходил(а) {away} дн.", "text": f"{pub['name']} пропал(а)", "away": away})
    events.sort(key=lambda e: e["at"] or "", reverse=True)
    events = events[:FEED_LIMIT]
    # реакции
    if events:
        marks = ",".join("?" * len(events))
        rows = conn.execute(f"SELECT event_id, user_id, emoji FROM feed_reactions WHERE event_id IN ({marks})",
                            [e["id"] for e in events]).fetchall()
        by = {}
        for r in rows:
            by.setdefault(r["event_id"], []).append((r["user_id"], r["emoji"]))
        for e in events:
            rs = by.get(e["id"], [])
            counts = {}
            for _, em in rs:
                counts[em] = counts.get(em, 0) + 1
            e["reactions"] = [{"emoji": em, "count": counts.get(em, 0)} for em in REACTIONS if counts.get(em)]
            e["mine"] = next((em for uid, em in rs if uid == user_id), None)
    # пинки сегодня
    pinged = {(r[0], r[1]) for r in conn.execute("SELECT friend_id, kind FROM friend_pings WHERE user_id = ? AND date = ?",
                                                 (user_id, today.isoformat())).fetchall()}
    for e in events:
        e["can_cheer"] = (e["friend"]["id"], "cheer") not in pinged
        e["can_poke"] = (e["friend"]["id"], "poke") not in pinged
    conn.close()
    return {"events": events, "reactions": list(REACTIONS), "pair": pair_list(user_id)}


def react(user_id: int, event_id: str, emoji: str) -> dict:
    """Поставить или снять реакцию. Хозяину события — сообщение (один раз на событие)."""
    ensure_tables()
    if emoji and emoji not in REACTIONS:
        raise game.QuestError("Такой реакции нет")
    parts = event_id.split(":")
    if len(parts) < 3 or not parts[1].isdigit():
        raise game.QuestError("Событие не найдено")
    friend_id = int(parts[1])
    conn = storage.connect()
    if not conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (user_id, friend_id)).fetchone():
        conn.close()
        raise game.QuestError("Это не твой друг")
    had = conn.execute("SELECT emoji FROM feed_reactions WHERE event_id = ? AND user_id = ?", (event_id, user_id)).fetchone()
    messages = []
    if not emoji:
        conn.execute("DELETE FROM feed_reactions WHERE event_id = ? AND user_id = ?", (event_id, user_id))
    else:
        conn.execute("INSERT OR REPLACE INTO feed_reactions (event_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)",
                     (event_id, user_id, emoji, storage.utc_now_str()))
        if not had:
            who = html.escape(_name(storage.get_user(user_id)))
            what = {"q": "на твой квест", "s": "на твою серию", "a": "— скучает по тебе"}.get(parts[0], "")
            messages.append((friend_id, f"{emoji} {who} отреагировал(а) {what}. Загляни в «Друзья»!"))
    conn.commit()
    conn.close()
    return {"ok": True, "mine": emoji or None, "messages": messages}


def ping(user_id: int, friend_id: int, kind: str) -> dict:
    """«Подбодрить» или «пнуть» друга — смешное сообщение от твоего маскота, раз в день."""
    ensure_tables()
    if kind not in ("cheer", "poke"):
        raise game.QuestError("Неизвестное действие")
    me = storage.get_user(user_id)
    fu = storage.get_user(friend_id)
    if not fu:
        raise game.QuestError("Друг не найден")
    conn = storage.connect()
    if not conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (user_id, friend_id)).fetchone():
        conn.close()
        raise game.QuestError("Это не твой друг")
    today = game.local_today(me).isoformat()
    cur = conn.execute("INSERT OR IGNORE INTO friend_pings (user_id, friend_id, date, kind) VALUES (?, ?, ?, ?)",
                       (user_id, friend_id, today, kind))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise game.QuestError("Сегодня уже отправлено — завтра можно снова 😉")
    who = html.escape(_name(me))
    line = random.choice(CHEER_LINES if kind == "cheer" else POKE_LINES).format(who=who)
    return {"ok": True, "messages": [(friend_id, ("👋 " if kind == "cheer" else "👉 ") + line)]}


# ---------- квест вдвоём ----------
def _pair_row(conn, pid: int):
    r = conn.execute("SELECT * FROM pair_quests WHERE id = ?", (pid,)).fetchone()
    return dict(r) if r else None


def _pair_view(r: dict, user_id: int) -> dict:
    i_am_creator = r["creator_id"] == user_id
    other_id = r["friend_id"] if i_am_creator else r["creator_id"]
    other = storage.get_user(other_id) or {"user_id": other_id}
    return {"id": r["id"], "quest_key": r["quest_key"], "title": r["title"], "emoji": r["emoji"], "text": r["text"],
            "status": r["status"], "created_at": r["created_at"],
            "me_done": bool(r["creator_done"] if i_am_creator else r["friend_done"]),
            "friend_done": bool(r["friend_done"] if i_am_creator else r["creator_done"]),
            "mine": i_am_creator, "friend": _public(other), "bonus_xp": PAIR_BONUS_XP}


def pair_list(user_id: int) -> dict:
    ensure_tables()
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute("""SELECT * FROM pair_quests WHERE (creator_id = ? OR friend_id = ?)
                                             AND status IN ('pending', 'active') ORDER BY id DESC LIMIT 20""",
                                          (user_id, user_id)).fetchall()]
    conn.close()
    views = [_pair_view(r, user_id) for r in rows]
    return {"incoming": [v for v in views if v["status"] == "pending" and not v["mine"]],
            "outgoing": [v for v in views if v["status"] == "pending" and v["mine"]],
            "active": [v for v in views if v["status"] == "active"]}


def pair_create(user_id: int, friend_id: int, quest_key: str = None, rng=random) -> dict:
    """Позвать друга на квест вдвоём: случайный парный квест или конкретный."""
    ensure_tables()
    me = storage.get_user(user_id)
    fu = storage.get_user(friend_id)
    if not fu:
        raise game.QuestError("Друг не найден")
    conn = storage.connect(rows=True)
    if not conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (user_id, friend_id)).fetchone():
        conn.close()
        raise game.QuestError("Сначала добавь друга по ссылке-приглашению")
    open_n = conn.execute("""SELECT COUNT(*) FROM pair_quests WHERE creator_id = ? AND friend_id = ?
                             AND status IN ('pending', 'active')""", (user_id, friend_id)).fetchone()[0]
    if open_n >= 3:
        conn.close()
        raise game.QuestError("С этим другом уже три открытых квеста — закройте их сначала 💪")
    q = CATALOG.get(quest_key) if quest_key else None
    if not q:
        pool = [x for x in CATALOG.values() if x["mode"] == "pair" and not x.get("pack")]
        q = rng.choice(pool)
    conn.execute("""INSERT INTO pair_quests (creator_id, friend_id, quest_key, title, emoji, text, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)""",
                 (user_id, friend_id, q["id"], q["title"], q.get("emoji") or "🤝", q.get("text") or "", storage.utc_now_str()))
    pid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    r = _pair_row(conn, pid)
    conn.close()
    who = html.escape(_name(me))
    msg = (f"🤝 {who} зовёт тебя на квест вдвоём: «{html.escape(q.get('emoji') or '')} {html.escape(q['title'])}».\n"
           f"Сделаете оба — каждому +{PAIR_BONUS_XP} XP. Ответь в приложении!")
    return {"ok": True, "pair": _pair_view(r, user_id), "messages": [(friend_id, msg)]}


def pair_action(user_id: int, pid: int, action: str) -> dict:
    """accept / decline — для приглашённого; done — любой участник; cancel — создатель."""
    ensure_tables()
    conn = storage.connect(rows=True)
    r = _pair_row(conn, pid)
    if not r or user_id not in (r["creator_id"], r["friend_id"]):
        conn.close()
        raise game.QuestError("Квест не найден")
    me = storage.get_user(user_id)
    who = html.escape(_name(me))
    other_id = r["friend_id"] if r["creator_id"] == user_id else r["creator_id"]
    title = f"{html.escape(r['emoji'] or '')} {html.escape(r['title'])}"
    messages = []
    if action == "accept" and r["status"] == "pending" and user_id == r["friend_id"]:
        conn.execute("UPDATE pair_quests SET status = 'active' WHERE id = ?", (pid,))
        messages.append((other_id, f"🤝 {who} в деле! Квест вдвоём «{title}» начался — сделайте оба."))
    elif action == "decline" and r["status"] == "pending" and user_id == r["friend_id"]:
        conn.execute("UPDATE pair_quests SET status = 'declined', finished_at = ? WHERE id = ?", (storage.utc_now_str(), pid))
        messages.append((other_id, f"😿 {who} пока не может на квест «{title}». Позови в другой раз!"))
    elif action == "cancel" and r["status"] in ("pending", "active") and user_id == r["creator_id"]:
        conn.execute("UPDATE pair_quests SET status = 'cancelled', finished_at = ? WHERE id = ?", (storage.utc_now_str(), pid))
    elif action == "done" and r["status"] == "active":
        col = "creator_done" if user_id == r["creator_id"] else "friend_done"
        conn.execute(f"UPDATE pair_quests SET {col} = 1 WHERE id = ?", (pid,))
        r2 = _pair_row(conn, pid)
        if r2["creator_done"] and r2["friend_done"]:
            conn.execute("UPDATE pair_quests SET status = 'done', finished_at = ? WHERE id = ?", (storage.utc_now_str(), pid))
            conn.commit()
            today = game.local_today(me).isoformat()
            for uid in (r["creator_id"], r["friend_id"]):
                game.add_xp(uid, PAIR_BONUS_XP, f"pair:{r['quest_key']}", today)
            messages.append((other_id, f"🎉 Квест вдвоём «{title}» закрыт — вы оба молодцы! +{PAIR_BONUS_XP} XP каждому."))
        else:
            messages.append((other_id, f"✅ {who} уже сделал(а) «{title}». Твоя очередь — закрой квест, и обоим +{PAIR_BONUS_XP} XP!"))
    else:
        conn.close()
        raise game.QuestError("Так сейчас нельзя")
    conn.commit()
    r = _pair_row(conn, pid)
    conn.close()
    return {"ok": True, "pair": _pair_view(r, user_id), "messages": messages}

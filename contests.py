"""Свои соревнования с друзьями.

Путь: создатель задаёт название и срок → делится ссылкой
t.me/<bot>?start=c_<id> → друг видит приглашение и жмёт «Участвую» или
«Отказаться» (без обсуждений и предложений) → создатель собирает пункты
(сам или из шаблонов) → «Запустить». После запуска правила заморожены и
новые участники не входят. Каждый день участник отмечает пункты: сделал или
нет. Очки копятся, в конце — итоги и награды.

Статусы соревнования: lobby → active → done; lobby → cancelled (отменил
создатель или истёк таймаут лобби).

Функции, которые должны что-то сообщить в Telegram, возвращают список
(user_id, text) — отправляет вызывающий код (бот или API)."""

import html
from datetime import date, datetime, timedelta

import duels
import friends
import game
import storage

DAYS = (3, 7, 14, 30)
MIN_MEMBERS = 2
MAX_MEMBERS = 20
ITEMS_FREE, ITEMS_PREMIUM = 5, 10
ACTIVE_CREATED_LIMIT = 3       # своих соревнований в лобби или в игре одновременно
LOBBY_DAYS = 7                 # лобби без запуска живёт неделю
LOBBY_REMIND_DAY = 5           # за два дня до конца напоминаем создателю
MAX_POINTS = 20
MAX_VALUE = 100000
XP_PLAYED = 20                 # всем, кто набрал хоть одно очко, кроме победителей
EVENING_HOUR = 21

# Готовые наборы пунктов: (эмодзи, название, тип, единица, норма, очки)
TEMPLATES = [
    {"id": "sport", "emoji": "🏋️", "title": "Спорт", "items": [
        ("💪", "30 отжиманий", "check", "", None, 10),
        ("🦵", "40 приседаний", "check", "", None, 10),
        ("👟", "8 000 шагов", "check", "", None, 10),
    ]},
    {"id": "clean", "emoji": "🍩", "title": "Без вредного", "items": [
        ("🍬", "Без сахара", "check", "", None, 10),
        ("🍔", "Без фастфуда", "check", "", None, 10),
        ("📵", "Без соцсетей после 23:00", "check", "", None, 10),
    ]},
    {"id": "growth", "emoji": "📚", "title": "Саморазвитие", "items": [
        ("📖", "Чтение 20 страниц", "check", "", None, 10),
        ("🗣", "Иностранный язык 15 минут", "check", "", None, 10),
        ("🧘", "Медитация", "check", "", None, 10),
    ]},
    {"id": "routine", "emoji": "🌅", "title": "Режим", "items": [
        ("⏰", "Подъём до 7:00", "check", "", None, 10),
        ("💧", "Вода 2 литра", "check", "", None, 10),
        ("😴", "Сон до 23:00", "check", "", None, 10),
    ]},
]


# ---------- служебное ----------
def _conn():
    return storage.connect(rows=True)


def _row(contest_id: int) -> dict:
    conn = _conn()
    r = conn.execute("SELECT * FROM contests WHERE id = ?", (contest_id,)).fetchone()
    conn.close()
    if not r:
        raise game.QuestError("Соревнование не найдено")
    return dict(r)


def _name(user_id: int) -> str:
    u = storage.get_user(user_id) or {}
    return u.get("first_name") or u.get("username") or "Друг"


def _today(user_id: int) -> date:
    return game.local_today(storage.get_user(user_id))


def _members(contest_id: int, include_left: bool = False) -> list:
    conn = _conn()
    sql = "SELECT user_id, status, joined_at FROM contest_members WHERE contest_id = ?"
    if not include_left:
        sql += " AND status = 'in'"
    rows = [dict(r) for r in conn.execute(sql + " ORDER BY joined_at, user_id", (contest_id,)).fetchall()]
    conn.close()
    return rows


def _member_ids(contest_id: int) -> list:
    return [m["user_id"] for m in _members(contest_id)]


def _is_member(contest_id: int, user_id: int) -> bool:
    return user_id in _member_ids(contest_id)


def is_member(contest_id: int, user_id: int) -> bool:
    return _is_member(contest_id, user_id)


def was_member(contest_id: int, user_id: int) -> bool:
    """Участник сейчас или раньше (сдавшийся видит итоги). Для доступа из API."""
    conn = _conn()
    row = conn.execute("SELECT 1 FROM contest_members WHERE contest_id = ? AND user_id = ?",
                       (contest_id, user_id)).fetchone()
    conn.close()
    return bool(row)


def _items(contest_id: int) -> list:
    conn = _conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM contest_items WHERE contest_id = ? ORDER BY position, id",
                                          (contest_id,)).fetchall()]
    conn.close()
    return rows


def _items_limit(creator_id: int) -> int:
    return ITEMS_PREMIUM if game.is_premium(storage.get_user(creator_id) or {}) else ITEMS_FREE


def _clean_text(value, limit: int, what: str, required: bool = True) -> str:
    text = " ".join(str(value or "").split())[:limit]
    if required and not text:
        raise game.QuestError(f"Заполни поле «{what}»")
    return text


def _clean_item(data: dict) -> dict:
    """Проверка граф пункта (форма «Пункт соревнования»). Пункт — всегда
    «сделал / не сделал»: без единиц и нормы в день."""
    title = _clean_text(data.get("title"), 60, "Занятие")
    emoji = _clean_text(data.get("emoji"), 8, "", required=False) or "✅"
    try:
        raw = data.get("points")
        points = int(raw) if raw not in (None, "") else 10
    except (TypeError, ValueError):
        raise game.QuestError("Очки — это целое число")
    if not 1 <= points <= MAX_POINTS:
        raise game.QuestError(f"Очки — от 1 до {MAX_POINTS}")
    return {"title": title, "emoji": emoji, "kind": "check", "unit": "", "norm": None, "points": points}


def _require(c: dict, user_id: int, *, creator: bool = False, status: str = None):
    if creator and c["creator_id"] != user_id:
        raise game.QuestError("Это может только создатель соревнования")
    if not creator and not _is_member(c["id"], user_id):
        raise game.QuestError("Ты не участвуешь в этом соревновании")
    if status == "lobby" and c["status"] != "lobby":
        raise game.QuestError("Соревнование уже запущено — правила заморожены 🔒")
    if status == "active" and c["status"] != "active":
        raise game.QuestError("Соревнование сейчас не идёт")


def _title(c: dict) -> str:
    return f"{html.escape(c['emoji'] or '🏆')} {html.escape(c['title'])}"


# ---------- лобби ----------
def create(user_id: int, data: dict) -> dict:
    """Шаг 1: название и срок. Создатель сразу становится участником."""
    title = _clean_text(data.get("title"), 60, "Название")
    emoji = _clean_text(data.get("emoji"), 8, "", required=False) or "🏆"
    try:
        days = int(data.get("days") or 7)
    except (TypeError, ValueError):
        days = 0
    if days not in DAYS:
        raise game.QuestError("Длительность — 3, 7, 14 или 30 дней")
    conn = _conn()
    busy = conn.execute("SELECT COUNT(*) FROM contests WHERE creator_id = ? AND status IN ('lobby', 'active')",
                        (user_id,)).fetchone()[0]
    if busy >= ACTIVE_CREATED_LIMIT:
        conn.close()
        raise game.QuestError(f"Одновременно можно вести до {ACTIVE_CREATED_LIMIT} своих соревнований")
    now = storage.utc_now_str()
    cur = conn.execute("""INSERT INTO contests (creator_id, title, emoji, days, status, created_at)
                          VALUES (?, ?, ?, ?, 'lobby', ?)""", (user_id, title, emoji, days, now))
    cid = cur.lastrowid
    conn.execute("INSERT INTO contest_members (contest_id, user_id, status, joined_at) VALUES (?, ?, 'in', ?)",
                 (cid, user_id, now))
    conn.commit()
    conn.close()
    return {"contest": view(cid, user_id)}


def public_invite(contest_id: int) -> dict:
    c = _row(contest_id)
    return {"id": c["id"], "title": c["title"], "emoji": c["emoji"], "days": c["days"], "status": c["status"],
            "creator": _name(c["creator_id"]), "creator_id": c["creator_id"]}


def join(user_id: int, contest_id: int) -> dict:
    """Вход по ссылке. Только пока идёт настройка — после запуска двери закрыты."""
    c = _row(contest_id)
    if _is_member(contest_id, user_id):
        return {"contest": view(contest_id, user_id), "messages": [], "already": True}
    if c["status"] == "active":
        raise game.QuestError("Соревнование уже началось — новых участников не принимаем 🔒")
    if c["status"] != "lobby":
        raise game.QuestError("Это соревнование уже закончилось")
    if len(_member_ids(contest_id)) >= MAX_MEMBERS:
        raise game.QuestError(f"В соревновании уже {MAX_MEMBERS} участников — мест нет")
    if storage.get_user(c["creator_id"]):
        friends.add_friend(user_id, c["creator_id"])
    conn = _conn()
    conn.execute("""INSERT INTO contest_members (contest_id, user_id, status, joined_at) VALUES (?, ?, 'in', ?)
                    ON CONFLICT(contest_id, user_id) DO UPDATE SET status = 'in', joined_at = excluded.joined_at""",
                 (contest_id, user_id, storage.utc_now_str()))
    conn.commit()
    conn.close()
    n = len(_member_ids(contest_id))
    note = (f"🙌 {html.escape(_name(user_id))} принимает приглашение в «{_title(c)}»! Участников: {n}."
            + ("\nМожно добавлять пункты и запускать." if n >= MIN_MEMBERS else ""))
    return {"contest": view(contest_id, user_id), "messages": [(c["creator_id"], note)]}


def decline(user_id: int, contest_id: int) -> dict:
    """«Отказаться» под приглашением: просто сообщаем создателю."""
    c = _row(contest_id)
    if _is_member(contest_id, user_id):
        raise game.QuestError("Ты уже участвуешь — выйти можно в приложении")
    if c["status"] != "lobby":
        return {"ok": True, "messages": []}
    return {"ok": True, "messages": [(c["creator_id"], f"🙅 {html.escape(_name(user_id))} не будет участвовать "
                                                      f"в «{_title(c)}».")]}


def leave(user_id: int, contest_id: int) -> dict:
    """Выйти из лобби, сдаться в идущем соревновании или (создатель в лобби) отменить его."""
    c = _row(contest_id)
    if c["status"] == "lobby" and c["creator_id"] == user_id:
        return cancel(user_id, contest_id)
    _require(c, user_id)
    if c["status"] not in ("lobby", "active"):
        raise game.QuestError("Соревнование уже закончилось")
    conn = _conn()
    conn.execute("UPDATE contest_members SET status = 'left' WHERE contest_id = ? AND user_id = ?",
                 (contest_id, user_id))
    conn.commit()
    conn.close()
    who = html.escape(_name(user_id))
    if c["status"] == "lobby":
        return {"ok": True, "messages": [(c["creator_id"], f"🚪 {who} вышел(а) из лобби «{_title(c)}».")]}
    msgs = [(uid, f"🏳️ {who} сдаётся в соревновании «{_title(c)}».") for uid in _member_ids(contest_id)]
    return {"ok": True, "messages": msgs}


def cancel(user_id: int, contest_id: int) -> dict:
    c = _row(contest_id)
    _require(c, user_id, creator=True, status="lobby")
    _set(contest_id, status="cancelled", finished_at=storage.utc_now_str())
    msgs = [(uid, f"🙈 {html.escape(_name(user_id))} отменяет соревнование «{_title(c)}».")
            for uid in _member_ids(contest_id) if uid != user_id]
    return {"ok": True, "messages": msgs}


def _set(contest_id: int, **fields):
    conn = _conn()
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE contests SET {sets} WHERE id = ?", (*fields.values(), contest_id))
    conn.commit()
    conn.close()


# ---------- пункты (только создатель, только в лобби) ----------
def _insert_item(contest_id: int, item: dict, proposed_by: int = None) -> int:
    conn = _conn()
    pos = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM contest_items WHERE contest_id = ?",
                       (contest_id,)).fetchone()[0]
    cur = conn.execute("""INSERT INTO contest_items (contest_id, title, emoji, kind, unit, norm, points, position,
                          proposed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (contest_id, item["title"], item["emoji"], item["kind"], item["unit"], item["norm"],
                        item["points"], pos, proposed_by))
    conn.commit()
    conn.close()
    return cur.lastrowid


def _check_room(c: dict, adding: int = 1):
    limit = _items_limit(c["creator_id"])
    if len(_items(c["id"])) + adding > limit:
        code = "contest_items" if limit < ITEMS_PREMIUM else None
        raise game.QuestError(f"В соревновании — до {limit} пунктов"
                              + (" (в Premium — до 10)" if code else ""), code=code)


def add_item(user_id: int, contest_id: int, data: dict) -> dict:
    c = _row(contest_id)
    _require(c, user_id, creator=True, status="lobby")
    item = _clean_item(data)
    _check_room(c)
    _insert_item(contest_id, item)
    return {"contest": view(contest_id, user_id)}


def update_item(user_id: int, contest_id: int, item_id: int, data: dict) -> dict:
    c = _row(contest_id)
    _require(c, user_id, creator=True, status="lobby")
    item = _clean_item(data)
    conn = _conn()
    cur = conn.execute("""UPDATE contest_items SET title = ?, emoji = ?, kind = ?, unit = ?, norm = ?, points = ?
                          WHERE id = ? AND contest_id = ?""",
                       (item["title"], item["emoji"], item["kind"], item["unit"], item["norm"], item["points"],
                        item_id, contest_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise game.QuestError("Пункт не найден")
    return {"contest": view(contest_id, user_id)}


def delete_item(user_id: int, contest_id: int, item_id: int) -> dict:
    c = _row(contest_id)
    _require(c, user_id, creator=True, status="lobby")
    conn = _conn()
    conn.execute("DELETE FROM contest_items WHERE id = ? AND contest_id = ?", (item_id, contest_id))
    conn.commit()
    conn.close()
    return {"contest": view(contest_id, user_id)}


def apply_template(user_id: int, contest_id: int, template_id: str) -> dict:
    """Добавить пункты шаблона (те, что уже есть по названию, пропускаем)."""
    c = _row(contest_id)
    _require(c, user_id, creator=True, status="lobby")
    tpl = next((t for t in TEMPLATES if t["id"] == template_id), None)
    if not tpl:
        raise game.QuestError("Шаблон не найден")
    have = {i["title"].lower() for i in _items(contest_id)}
    fresh = [t for t in tpl["items"] if t[1].lower() not in have]
    if not fresh:
        raise game.QuestError("Все пункты этого шаблона уже в списке")
    room = _items_limit(c["creator_id"]) - len(have)
    if room <= 0:
        _check_room(c)
    for emoji, title, kind, unit, norm, points in fresh[:room]:
        _insert_item(contest_id, {"emoji": emoji, "title": title, "kind": kind, "unit": unit,
                                  "norm": norm, "points": points})
    out = {"contest": view(contest_id, user_id), "added": min(room, len(fresh))}
    if len(fresh) > room:
        out["note"] = f"Добавлено {room} из {len(fresh)} — больше пунктов не помещается"
    return out


# ---------- запуск и заморозка ----------
def launch(user_id: int, contest_id: int) -> dict:
    """Старт: нажать может любой участник в любой момент, если есть хотя бы
    1 пункт и 2 участника."""
    c = _row(contest_id)
    _require(c, user_id, status="lobby")
    items = _items(contest_id)
    members = _member_ids(contest_id)
    if not items:
        raise game.QuestError("Добавь хотя бы один пункт — без правил соревноваться не в чем")
    if len(members) < MIN_MEMBERS:
        raise game.QuestError("Нужно хотя бы 2 участника — отправь ссылку другу")
    messages = []
    start = _today(user_id)
    end = start + timedelta(days=c["days"] - 1)
    conn = _conn()
    # предложения из старой версии (с модерацией) просто закрываем
    conn.execute("UPDATE contest_proposals SET status = 'rejected' WHERE contest_id = ? AND status = 'pending'",
                 (contest_id,))
    cur = conn.execute("""UPDATE contests SET status = 'active', start_date = ?, end_date = ?, started_at = ?
                          WHERE id = ? AND status = 'lobby'""",
                       (start.isoformat(), end.isoformat(), storage.utc_now_str(), contest_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise game.QuestError("Соревнование уже запущено")
    rules = "\n".join(f"{html.escape(i['emoji'])} {html.escape(i['title'])} — {_rule_text(i)}" for i in items)
    who = "" if user_id == c["creator_id"] else f"🚀 Запустил(а): {html.escape(_name(user_id))}\n"
    for uid in members:
        messages.append((uid, f"🔥 <b>Соревнование «{_title(c)}» началось!</b>\n{who}"
                              f"{_dmy(start)} — {_dmy(end)}, {c['days']} {_plural(c['days'], 'день', 'дня', 'дней')}, "
                              f"участников: {len(members)}.\n\n<b>Правила</b> 🔒\n{rules}\n\n"
                              f"Отмечай пункты каждый день в приложении. Удачи!"))
    return {"contest": view(contest_id, user_id), "messages": messages}


def _rule_text(i: dict) -> str:
    if i["kind"] == "check":
        return f"+{i['points']} за день"
    norm = f", норма {i['norm']} {i['unit']} в день" if i.get("norm") else ""
    return f"+{i['points']} за каждую единицу ({i['unit']}){norm}"


def _dmy(d: date) -> str:
    return d.strftime("%d.%m")


def _plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(n) % 100
    if 11 <= n <= 19:
        return many
    n %= 10
    return one if n == 1 else few if 2 <= n <= 4 else many


# ---------- ежедневные отметки ----------
def log(user_id: int, contest_id: int, item_id: int, value) -> dict:
    """Отметка на сегодня (по часовому поясу участника): для «сделал» —
    0/1, для числа — сколько всего за сегодня. Прошлые дни не правятся."""
    c = _row(contest_id)
    _require(c, user_id, status="active")
    item = next((i for i in _items(contest_id) if i["id"] == item_id), None)
    if not item:
        raise game.QuestError("Пункт не найден")
    today = _today(user_id)
    iso = today.isoformat()
    if iso < c["start_date"]:
        raise game.QuestError("Соревнование начнётся завтра — отмечать пока рано")
    if iso > c["end_date"]:
        raise game.QuestError("Соревнование уже закончилось — ждём итогов")
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise game.QuestError("Нужно целое число")
    if item["kind"] == "check":
        value = 1 if value else 0
    if not 0 <= value <= MAX_VALUE:
        raise game.QuestError(f"Число — от 0 до {MAX_VALUE}")
    conn = _conn()
    if value:
        conn.execute("""INSERT INTO contest_logs (contest_id, item_id, user_id, local_date, value, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(item_id, user_id, local_date)
                        DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
                     (contest_id, item_id, user_id, iso, value, storage.utc_now_str()))
    else:
        conn.execute("DELETE FROM contest_logs WHERE item_id = ? AND user_id = ? AND local_date = ?",
                     (item_id, user_id, iso))
    conn.commit()
    conn.close()
    return {"contest": view(contest_id, user_id)}


def _logs(contest_id: int) -> list:
    conn = _conn()
    rows = [dict(r) for r in conn.execute("SELECT item_id, user_id, local_date, value FROM contest_logs WHERE contest_id = ?",
                                          (contest_id,)).fetchall()]
    conn.close()
    return rows


def _item_done(item: dict, value: int) -> bool:
    return value >= (item.get("norm") or 1) if item["kind"] == "count" else value >= 1


def _board(c: dict, items: list, members: list) -> list:
    """Таблица лидеров: очки, сколько по каждому пункту, отмечено ли сегодня."""
    by_item = {i["id"]: i for i in items}
    logs = _logs(c["id"]) if c["start_date"] else []
    rows = []
    for m in members:
        uid = m["user_id"]
        user = storage.get_user(uid)
        pub = friends._public(user) if user else {"id": uid, "name": "Участник", "mascot": None, "accessory": None}
        today = (game.local_today(user) if user else date.today()).isoformat()
        mine = [x for x in logs if x["user_id"] == uid and x["item_id"] in by_item
                and c["start_date"] <= x["local_date"] <= c["end_date"]]
        totals = {i["id"]: 0 for i in items}
        score = 0
        for x in mine:
            totals[x["item_id"]] += x["value"]
            score += x["value"] * by_item[x["item_id"]]["points"]
        today_vals = {x["item_id"]: x["value"] for x in mine if x["local_date"] == today}
        done_today = sum(1 for i in items if _item_done(i, today_vals.get(i["id"], 0)))
        rows.append({"id": uid, "name": pub.get("name"), "mascot": pub.get("mascot"), "accessory": pub.get("accessory"),
                     "score": score, "totals": {str(k): v for k, v in totals.items()},
                     "today": {str(k): v for k, v in today_vals.items()}, "today_iso": today,
                     "done_today": done_today, "all_today": bool(items) and done_today == len(items),
                     "left": m["status"] == "left"})
    rows.sort(key=lambda r: (r["left"], -r["score"], r["name"] or ""))
    place, prev = 0, None
    for i, r in enumerate(rows):
        if r["left"]:
            r["place"] = None
            continue
        if r["score"] != prev:
            place, prev = i + 1, r["score"]
        r["place"] = place
    return rows


def _public_item(i: dict) -> dict:
    return {"id": i["id"], "title": i["title"], "emoji": i["emoji"], "kind": i["kind"], "unit": i["unit"],
            "norm": i["norm"], "points": i["points"], "rule": _rule_text(i),
            "proposed_by": _name(i["proposed_by"]) if i.get("proposed_by") else None}


def view(contest_id: int, user_id: int) -> dict:
    c = _row(contest_id)
    items = _items(contest_id)
    everyone = _members(contest_id, include_left=c["status"] != "lobby")
    board = _board(c, items, everyone)
    mine = c["creator_id"] == user_id
    me = next((r for r in board if r["id"] == user_id), None)
    out = {
        "id": c["id"], "title": c["title"], "emoji": c["emoji"], "days": c["days"], "status": c["status"],
        "creator": {"id": c["creator_id"], "name": _name(c["creator_id"])}, "mine": mine,
        "member": bool(me and not me["left"]),
        "items": [_public_item(i) for i in items], "board": board, "me": me,
        "start": c["start_date"], "end": c["end_date"], "winners": [],
        "limits": {"items": _items_limit(c["creator_id"]), "members": MAX_MEMBERS, "min_members": MIN_MEMBERS},
        "members_count": sum(1 for r in board if not r["left"]),
    }
    if c["status"] == "lobby":
        created = datetime.strptime(c["created_at"], "%Y-%m-%d %H:%M:%S")
        left = LOBBY_DAYS - (datetime.utcnow() - created).days
        out["lobby_days_left"] = max(0, left)
        out["can_launch"] = bool(items) and out["members_count"] >= MIN_MEMBERS and bool(me and not me["left"])
    if c["start_date"] and me:
        today = date.fromisoformat(me["today_iso"])
        out["day"] = min(c["days"], max(1, (today - date.fromisoformat(c["start_date"])).days + 1))
        out["not_started"] = me["today_iso"] < c["start_date"]
    if c["status"] == "done":
        out["winners"] = [int(x) for x in (c["winners"] or "").split(",") if x]
    return out


def list_view(user_id: int) -> dict:
    conn = _conn()
    rows = conn.execute("""SELECT c.id FROM contests c JOIN contest_members m ON m.contest_id = c.id
                           WHERE m.user_id = ? AND (m.status = 'in' OR c.status = 'done')
                           AND (c.status IN ('lobby', 'active') OR (c.status = 'done' AND c.finished_at >= ?))
                           ORDER BY c.id DESC""",
                        (user_id, (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S"))).fetchall()
    conn.close()
    items = [view(r["id"], user_id) for r in rows]
    return {"lobby": [x for x in items if x["status"] == "lobby"],
            "active": [x for x in items if x["status"] == "active"],
            "finished": [x for x in items if x["status"] == "done"],
            "durations": list(DAYS), "templates": templates()}


def templates() -> list:
    return [{"id": t["id"], "emoji": t["emoji"], "title": t["title"],
             "items": [{"emoji": e, "title": ti, "kind": k, "unit": u, "norm": n, "points": p}
                       for e, ti, k, u, n, p in t["items"]]} for t in TEMPLATES]


def summary(user_id: int) -> list:
    """Для главной: идущие соревнования (яркая карточка с лидерами) и лобби."""
    out = []
    lv = list_view(user_id)
    for x in [*lv["active"], *lv["lobby"]]:
        if not x["member"]:
            continue
        me = x["me"] or {}
        top = [{"id": r["id"], "name": r["name"], "mascot": r["mascot"], "accessory": r["accessory"],
                "score": r["score"], "place": r["place"], "all_today": r["all_today"], "me": r["id"] == user_id}
               for r in x["board"] if not r["left"]][:4]
        out.append({"id": x["id"], "status": x["status"], "title": x["title"], "emoji": x["emoji"], "days": x["days"],
                    "day": x.get("day"), "not_started": x.get("not_started", False),
                    "place": me.get("place"), "score": me.get("score", 0), "done_today": me.get("done_today", 0),
                    "items": len(x["items"]), "count": x["members_count"], "top": top, "mine": x["mine"],
                    "can_launch": x.get("can_launch", False), "creator": x["creator"]["name"]})
    return out


# ---------- планировщик ----------
def finalize_due() -> list:
    """Закрываем соревнования, у которых последний день прошёл у всех
    участников. Победителям — шапочка, остальным с очками — XP."""
    conn = _conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM contests WHERE status = 'active'").fetchall()]
    conn.close()
    messages = []
    for c in rows:
        members = [uid for uid in _member_ids(c["id"]) if storage.get_user(uid)]
        if members and min(_today(uid) for uid in members).isoformat() <= c["end_date"]:
            continue
        board = [r for r in _board(c, _items(c["id"]), _members(c["id"])) if storage.get_user(r["id"])]
        top = board[0]["score"] if board else 0
        winners = [r["id"] for r in board if top > 0 and r["score"] == top]
        _set(c["id"], status="done", finished_at=storage.utc_now_str(), winners=",".join(map(str, winners)))
        lines = "\n".join(f"{['🥇', '🥈', '🥉'][r['place'] - 1] if r['place'] <= 3 else str(r['place']) + '.'} "
                          f"{html.escape(r['name'] or 'Участник')} — {r['score']}" for r in board[:10])
        for r in board:
            uid = r["id"]
            if uid in winners:
                head = "🏆 <b>Победа!</b>" if len(winners) == 1 else "🏆 <b>Победа — разделённое первое место!</b>"
                prize = html.escape(duels.winner_reward(uid)["text"])
            else:
                head = f"🎉 <b>Соревнование окончено!</b> Твоё место — {r['place']}."
                xp = XP_PLAYED if r["score"] > 0 else 0
                if xp:
                    game.add_xp(uid, xp, "contest", _today(uid).isoformat())
                prize = f"+{xp} XP за участие" if xp else "В следующий раз получится 💪"
            messages.append((uid, f"{head}\n«{_title(c)}» — итоги:\n\n{lines}\n\n{prize}"))
    return messages


def lobby_timeouts() -> list:
    """Лобби без запуска: на 5-й день напоминаем создателю, на 7-й — отменяем."""
    conn = _conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM contests WHERE status = 'lobby'").fetchall()]
    conn.close()
    messages = []
    now = datetime.utcnow()
    for c in rows:
        age = (now - datetime.strptime(c["created_at"], "%Y-%m-%d %H:%M:%S")).days
        if age >= LOBBY_DAYS:
            _set(c["id"], status="cancelled", finished_at=storage.utc_now_str())
            for uid in _member_ids(c["id"]):
                messages.append((uid, f"⌛ Соревнование «{_title(c)}» так и не запустили за {LOBBY_DAYS} дней — "
                                      f"черновик удалён. Можно создать новое в любой момент."))
        elif age >= LOBBY_REMIND_DAY and not c["reminded"]:
            _set(c["id"], reminded=1)
            left = LOBBY_DAYS - age
            messages.append((c["creator_id"], f"⏳ Соревнование «{_title(c)}» ждёт запуска. Через {left} "
                                              f"{_plural(left, 'день', 'дня', 'дней')} черновик удалится — "
                                              f"добавь пункты и жми «Запустить»."))
    return messages


def _ping(contest_id: int, user_id: int, day: str, kind: str) -> bool:
    conn = _conn()
    cur = conn.execute("INSERT OR IGNORE INTO contest_pings (contest_id, user_id, date, kind) VALUES (?, ?, ?, ?)",
                       (contest_id, user_id, day, kind))
    conn.commit()
    conn.close()
    return cur.rowcount == 1


def evening_alerts() -> list:
    """В 21:00 по времени участника: не всё отмечено — напоминаем (раз в день)."""
    conn = _conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM contests WHERE status = 'active'").fetchall()]
    conn.close()
    messages = []
    for c in rows:
        items = _items(c["id"])
        board = _board(c, items, _members(c["id"]))
        for r in board:
            user = storage.get_user(r["id"])
            if (not user or game.local_now(user).hour != EVENING_HOUR or r["all_today"]
                    or not c["start_date"] <= r["today_iso"] <= c["end_date"]):
                continue
            if not _ping(c["id"], r["id"], r["today_iso"], "evening"):
                continue
            left = len(items) - r["done_today"]
            messages.append((r["id"], f"⏰ «{_title(c)}»: сегодня не отмечено ещё {left} из {len(items)}. "
                                      f"Ты на {r['place']}-м месте ({r['score']} очк.) — успей до полуночи!"))
    return messages

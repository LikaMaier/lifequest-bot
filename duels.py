"""Вызовы привычек с друзьями.

Дуэль — кто за N дней чаще выполнит привычку. «Вместе» — общая серия:
день засчитан, только если привычку сделали оба. Каждый отмечает свою
привычку как обычно; вызов просто сравнивает их дни.

Ссылка для тех, кого ещё нет в боте: t.me/<bot>?start=d_<duel_id>.
Функции, которые должны что-то сообщить в Telegram, возвращают список
(user_id, text) — отправляет вызывающий код (бот или API)."""

import html
import random
from datetime import date, timedelta

import friends
import game
import habits
import storage

MODES = ("duel", "team")
DAYS = (3, 7, 14, 30)
ACTIVE_LIMIT = 5
XP_WIN, XP_TIE, XP_LOSE = 50, 25, 10
XP_TEAM_DAY, XP_TEAM_PERFECT = 5, 50
# Награда за победу над другом — шапочка (головной убор) для маскота, которой ещё нет
HATS = ("cap", "beanie", "beret", "party", "cowboy", "chef", "graduate", "tophat", "crown",
        "acorn", "knithat", "leafwreath", "pumpkin", "santa")


def winner_reward(user_id: int, rng=random) -> dict:
    """Шапочка, которой ещё нет у победителя; если собраны все — XP."""
    owned = game.owned_items(user_id)
    left = [h for h in HATS if h not in owned]
    if not left:
        game.add_xp(user_id, XP_WIN, "duel", _today(user_id).isoformat())
        return {"kind": "xp", "text": f"+{XP_WIN} XP (все шапочки уже собраны 👑)"}
    hat = rng.choice(left)
    conn = storage.connect()
    conn.execute("INSERT INTO purchases (user_id, item, price, created_at) VALUES (?, ?, 0, ?)",
                 (user_id, hat, storage.utc_now_str()))
    conn.commit()
    conn.close()
    name = next(a[1] for a in (*game.ACCESSORIES, *game.SEASONAL_ACCESSORIES) if a[0] == hat)
    return {"kind": "hat", "id": hat, "name": name,
            "text": f"🎩 Награда — «{name}» для маскота! Надень её в Магазине."}


def _row(duel_id: int) -> dict:
    conn = storage.connect(rows=True)
    r = conn.execute("SELECT * FROM habit_duels WHERE id = ?", (duel_id,)).fetchone()
    conn.close()
    if not r:
        raise game.QuestError("Вызов не найден")
    return dict(r)


def _name(user_id: int) -> str:
    u = storage.get_user(user_id) or {}
    return u.get("first_name") or u.get("username") or "Друг"


def _today(user_id: int) -> date:
    return game.local_today(storage.get_user(user_id))


def _active_count(user_id: int) -> int:
    conn = storage.connect()
    # входящие приглашения не считаются — иначе их нельзя было бы принять
    n = conn.execute("""SELECT COUNT(*) FROM habit_duels WHERE (status = 'active' AND (creator_id = ? OR opponent_id = ?))
                        OR (status = 'pending' AND creator_id = ?)""", (user_id, user_id, user_id)).fetchone()[0]
    conn.close()
    return n


def _update(duel_id: int, **fields):
    conn = storage.connect()
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE habit_duels SET {sets} WHERE id = ?", (*fields.values(), duel_id))
    conn.commit()
    conn.close()


def create(user_id: int, data: dict) -> dict:
    """Новый вызов на основе своей привычки. friend_id — сразу другу (ему
    придёт сообщение), без него — вызов по ссылке."""
    habit = habits._get(user_id, int(data.get("habit_id") or 0))
    if habit.get("kind") == "quit":
        raise game.QuestError("Для вызова нужна привычка «делать», а не «бросить»")
    mode = data.get("mode") if data.get("mode") in MODES else "duel"
    try:
        days = int(data.get("days") or 7)
    except (TypeError, ValueError):
        days = 7
    if days not in DAYS:
        raise game.QuestError("Длительность вызова — 3, 7, 14 или 30 дней")
    friend_id = data.get("friend_id")
    friend_id = int(friend_id) if friend_id not in (None, "") else None
    if friend_id is not None and not friends.are_friends(user_id, friend_id):
        raise game.QuestError("Вызвать можно только друга")
    if _active_count(user_id) >= ACTIVE_LIMIT:
        raise game.QuestError(f"Одновременно можно вести до {ACTIVE_LIMIT} вызовов")
    conn = storage.connect()
    cur = conn.execute("""INSERT INTO habit_duels (creator_id, opponent_id, mode, title, emoji, target, days,
                          creator_habit, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
                       (user_id, friend_id, mode, habit["title"], habit.get("emoji") or "✨", habit.get("target") or 1,
                        days, habit["id"], storage.utc_now_str()))
    conn.commit()
    duel_id = cur.lastrowid
    conn.close()
    messages = []
    if friend_id:
        messages.append((friend_id, invite_text(duel_id), [("✅ Принимаю", f"du:a:{duel_id}"), ("Не сейчас", f"du:d:{duel_id}")]))
    return {"duel": view(_row(duel_id), user_id), "messages": messages}


def mode_text(mode: str, days: int) -> str:
    if mode == "team":
        return f"вместе {days} дн. — общая серия, день считается, только если сделали оба"
    return f"дуэль на {days} дн. — кто чаще выполнит, тот и победил"


def invite_text(duel_id: int) -> str:
    d = _row(duel_id)
    who = html.escape(_name(d["creator_id"]))
    goal = f" ({d['target']} раз в день)" if (d["target"] or 1) > 1 else ""
    return (f"⚔️ <b>{who} вызывает тебя на привычку!</b>\n\n{html.escape(d['emoji'] or '✨')} "
            f"<b>{html.escape(d['title'])}</b>{goal}\n{mode_text(d['mode'], d['days'])}.\n\n"
            f"Принять вызов — в приложении, раздел «Друзья» 👇")


def _habit_for(user_id: int, d: dict) -> int:
    """Привычка участника: такая же по названию или новая копия."""
    for h in habits.habits_view(user_id):
        if h["kind"] == "build" and h["title"].strip().lower() == d["title"].strip().lower():
            return h["id"]
    res = habits.create_habit(user_id, {"title": d["title"], "emoji": d["emoji"], "target": d["target"]})
    return res["habit"]["id"]


def accept(user_id: int, duel_id: int) -> dict:
    d = _row(duel_id)
    if d["status"] != "pending":
        raise game.QuestError("Этот вызов уже не ждёт ответа")
    if d["creator_id"] == user_id:
        raise game.QuestError("Свой вызов принять нельзя — отправь его другу")
    if d["opponent_id"] not in (None, user_id):
        raise game.QuestError("Этот вызов адресован не тебе")
    if not storage.get_user(d["creator_id"]):
        raise game.QuestError("Автор вызова больше не в LifeQuest")
    if _active_count(user_id) >= ACTIVE_LIMIT:
        raise game.QuestError(f"Одновременно можно вести до {ACTIVE_LIMIT} вызовов")
    friends.add_friend(user_id, d["creator_id"])
    habit_id = _habit_for(user_id, d)
    start = _today(user_id)
    end = start + timedelta(days=d["days"] - 1)
    conn = storage.connect()
    cur = conn.execute("""UPDATE habit_duels SET opponent_id = ?, opponent_habit = ?, status = 'active',
                          start_date = ?, end_date = ? WHERE id = ? AND status = 'pending'""",
                       (user_id, habit_id, start.isoformat(), end.isoformat(), duel_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise game.QuestError("Этот вызов уже не ждёт ответа")
    me = html.escape(_name(user_id))
    note = (f"✅ <b>{me} принимает вызов!</b>\n\n{html.escape(d['emoji'] or '✨')} «{html.escape(d['title'])}» — "
            f"{mode_text(d['mode'], d['days'])}. Старт сегодня, карточка уже на Главной. "
            + ("Держите общую серию вместе 🔥" if d["mode"] == "team" else "Поехали — кто кого? ⚔️"))
    return {"duel": view(_row(duel_id), user_id), "messages": [(d["creator_id"], note)]}


def decline(user_id: int, duel_id: int) -> dict:
    """Отказаться (получатель) или отменить (автор) ожидающий вызов."""
    d = _row(duel_id)
    if d["status"] != "pending" or user_id not in (d["creator_id"], d["opponent_id"]):
        raise game.QuestError("Этот вызов уже не ждёт ответа")
    _update(duel_id, status="cancelled" if user_id == d["creator_id"] else "declined")
    messages = []
    if user_id != d["creator_id"]:
        messages.append((d["creator_id"], f"🙈 {html.escape(_name(user_id))} пока отказывается от вызова "
                                          f"«{html.escape(d['title'])}». Попробуй позже или позови кого-то ещё."))
    return {"ok": True, "messages": messages}


def give_up(user_id: int, duel_id: int) -> dict:
    """Сдаться в активном вызове — вызов заканчивается сразу."""
    d = _row(duel_id)
    if d["status"] != "active" or user_id not in (d["creator_id"], d["opponent_id"]):
        raise game.QuestError("Вызов уже закончен")
    rival = d["opponent_id"] if user_id == d["creator_id"] else d["creator_id"]
    _update(duel_id, status="done", winner_id=rival if d["mode"] == "duel" else None,
            finished_at=storage.utc_now_str())
    if d["mode"] == "duel":
        prize = winner_reward(rival)
        if prize["kind"] == "hat":
            _update(duel_id, prize=prize["id"])
        text = f"🏳️ {html.escape(_name(user_id))} сдаётся в дуэли «{html.escape(d['title'])}». Победа твоя!\n{prize['text']}"
    else:
        text = f"🌧 {html.escape(_name(user_id))} завершает совместный вызов «{html.escape(d['title'])}». Ничего, бывает!"
    return {"ok": True, "messages": [(rival, text)]}


def remove(user_id: int, duel_id: int) -> dict:
    """Крестик на карточке: убрать дуэль из своего списка.
    Ожидающая — отменяется (или отклоняется), идущая — засчитывается как
    «сдался» (победа сопернику), законченная — просто скрывается."""
    d = _row(duel_id)
    if user_id not in (d["creator_id"], d["opponent_id"]):
        raise game.QuestError("Вызов не найден")
    messages = []
    if d["status"] == "pending":
        messages = decline(user_id, duel_id)["messages"]
    elif d["status"] == "active":
        messages = give_up(user_id, duel_id)["messages"]
    _update(duel_id, **{"hidden_creator" if user_id == d["creator_id"] else "hidden_opponent": 1})
    return {"ok": True, "messages": messages}


# ---------- прогресс ----------
def _done_dates(user_id: int, habit_id: int, start: str, end: str) -> set:
    if not habit_id:
        return set()
    conn = storage.connect()
    rows = conn.execute("""SELECT local_date FROM habit_logs WHERE habit_id = ? AND user_id = ? AND done = 1
                           AND local_date BETWEEN ? AND ?""", (habit_id, user_id, start, end)).fetchall()
    conn.close()
    return {r[0] for r in rows}


def _side(d: dict, user_id: int, habit_id: int) -> dict:
    user = storage.get_user(user_id)
    pub = friends._public(user) if user else {"id": user_id, "name": "Друг"}
    today = game.local_today(user) if user else date.today()
    days, done = [], 0
    if d["start_date"]:
        dates = _done_dates(user_id, habit_id, d["start_date"], d["end_date"])
        cur = date.fromisoformat(d["start_date"])
        for _ in range(d["days"]):
            iso = cur.isoformat()
            st = "done" if iso in dates else "future" if cur > today else "today" if cur == today else "miss"
            done += st == "done"
            days.append({"date": iso, "state": st})
            cur += timedelta(days=1)
    today_iso = today.isoformat()
    return {"id": user_id, "name": pub.get("name"), "mascot": pub.get("mascot"), "accessory": pub.get("accessory"),
            "habit_id": habit_id, "days": days, "score": done,
            "today_done": any(x["date"] == today_iso and x["state"] == "done" for x in days), "today": today_iso}


def _team(me: dict, rival: dict) -> dict:
    joint = [a["state"] == "done" and b["state"] == "done" for a, b in zip(me["days"], rival["days"])]
    past = [a["state"] not in ("future", "today") for a in me["days"]]
    streak = 0
    for i in range(len(joint) - 1, -1, -1):
        if joint[i]:
            streak += 1
        elif past[i]:
            break
    return {"joint": sum(joint), "streak": streak, "days": joint}


def view(d: dict, user_id: int) -> dict:
    mine = d["creator_id"] == user_id
    me = _side(d, user_id, d["creator_habit"] if mine else d["opponent_habit"])
    rival_id = d["opponent_id"] if mine else d["creator_id"]
    rival = _side(d, rival_id, d["opponent_habit"] if mine else d["creator_habit"]) if rival_id else None
    out = {"id": d["id"], "mode": d["mode"], "title": d["title"], "emoji": d["emoji"], "target": d["target"],
           "days": d["days"], "status": d["status"], "start": d["start_date"], "end": d["end_date"],
           "mine": mine, "me": me, "rival": rival, "winner": d.get("winner_id"),
           "prize": _prize(d.get("prize"))}
    if d["start_date"]:
        out["day"] = min(d["days"], max(1, (date.fromisoformat(me["today"]) - date.fromisoformat(d["start_date"])).days + 1))
    if rival and d["start_date"]:
        out["lead"] = "me" if me["score"] > rival["score"] else "rival" if rival["score"] > me["score"] else "tie"
        out["team"] = _team(me, rival)
        out["can_nudge"] = (d["status"] == "active" and not rival["today_done"]
                            and not _pinged(d["id"], user_id, me["today"], "nudge"))
    return out


def _prize(hat: str):
    if not hat:
        return None
    name = next((a[1] for a in (*game.ACCESSORIES, *game.SEASONAL_ACCESSORIES) if a[0] == hat), hat)
    return {"id": hat, "name": name}


def list_view(user_id: int) -> dict:
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT * FROM habit_duels WHERE
                           ((creator_id = ? AND COALESCE(hidden_creator, 0) = 0) OR (opponent_id = ? AND COALESCE(hidden_opponent, 0) = 0))
                           AND (status IN ('pending', 'active') OR (status = 'done' AND finished_at >= ?))
                           ORDER BY id DESC""",
                        (user_id, user_id, (date.today() - timedelta(days=7)).isoformat())).fetchall()
    conn.close()
    items = [view(dict(r), user_id) for r in rows]
    return {"active": [x for x in items if x["status"] == "active"],
            "incoming": [x for x in items if x["status"] == "pending" and not x["mine"]],
            "outgoing": [x for x in items if x["status"] == "pending" and x["mine"]],
            "finished": [x for x in items if x["status"] == "done"],
            "modes": list(MODES), "durations": list(DAYS)}


def public_invite(duel_id: int) -> dict:
    """Короткое описание вызова по ссылке — для человека, которого ещё нет в друзьях."""
    d = _row(duel_id)
    return {"id": d["id"], "title": d["title"], "emoji": d["emoji"], "mode": d["mode"], "days": d["days"],
            "status": d["status"], "creator": _name(d["creator_id"]), "creator_id": d["creator_id"]}


# ---------- уведомления ----------
def _pinged(duel_id: int, user_id: int, day: str, kind: str) -> bool:
    conn = storage.connect()
    row = conn.execute("SELECT 1 FROM duel_pings WHERE duel_id = ? AND user_id = ? AND date = ? AND kind = ?",
                       (duel_id, user_id, day, kind)).fetchone()
    conn.close()
    return bool(row)


def _ping(duel_id: int, user_id: int, day: str, kind: str) -> bool:
    """Отметить отправку; False — уже было сегодня."""
    conn = storage.connect()
    cur = conn.execute("INSERT OR IGNORE INTO duel_pings (duel_id, user_id, date, kind) VALUES (?, ?, ?, ?)",
                       (duel_id, user_id, day, kind))
    conn.commit()
    conn.close()
    return cur.rowcount == 1


def nudge(user_id: int, duel_id: int) -> dict:
    d = _row(duel_id)
    if d["status"] != "active" or user_id not in (d["creator_id"], d["opponent_id"]):
        raise game.QuestError("Вызов уже закончен")
    v = view(d, user_id)
    if v["rival"]["today_done"]:
        raise game.QuestError("Друг уже всё сделал сегодня 💪")
    if not _ping(duel_id, user_id, v["me"]["today"], "nudge"):
        raise game.QuestError("Сегодня пинок уже отправлен — завтра можно снова")
    who = html.escape(_name(user_id))
    text = (f"👉 {who} пинает тебя: «{html.escape(d['emoji'] or '')} {html.escape(d['title'])}» сегодня ещё не отмечена!\n"
            + (f"Общая серия {v['team']['streak']} дн. — не дай ей сгореть 🔥" if d["mode"] == "team"
               else f"Счёт: ты {v['rival']['score']} — {who} {v['me']['score']}."))
    return {"ok": True, "messages": [(v["rival"]["id"], text)], "duel": view(_row(duel_id), user_id)}


def on_habit_done(user_id: int, habit_id: int) -> list:
    """Участник выполнил привычку вызова — сообщаем сопернику (раз в день)."""
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT * FROM habit_duels WHERE status = 'active'
                           AND ((creator_id = ? AND creator_habit = ?) OR (opponent_id = ? AND opponent_habit = ?))""",
                        (user_id, habit_id, user_id, habit_id)).fetchall()
    conn.close()
    messages = []
    for r in rows:
        v = view(dict(r), user_id)
        if not v["me"]["today_done"] or not _ping(r["id"], user_id, v["me"]["today"], "done"):
            continue
        who = html.escape(_name(user_id))
        title = f"{html.escape(r['emoji'] or '')} {html.escape(r['title'])}"
        if v["rival"]["today_done"]:
            text = (f"🔥 «{title}»: сегодня ✓ у вас обоих — общая серия {v['team']['streak']} дн.!" if r["mode"] == "team"
                    else f"✅ {who}: «{title}» ✓. Счёт: ты {v['rival']['score']} — {who} {v['me']['score']}.")
        else:
            text = (f"⏰ {who}: «{title}» на сегодня ✓. Твоя очередь — иначе общая серия сгорит!"
                    if r["mode"] == "team" else f"⚡ {who}: «{title}» на сегодня ✓. Твой ход!")
        messages.append((v["rival"]["id"], text))
    return messages


def finalize_due() -> list:
    """Закрываем вызовы, у которых последний день прошёл у обоих участников.
    Начисляем XP и возвращаем сообщения с итогами."""
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute("SELECT * FROM habit_duels WHERE status = 'active'").fetchall()]
    conn.close()
    messages = []
    for d in rows:
        a, b = d["creator_id"], d["opponent_id"]
        if not storage.get_user(a) or not storage.get_user(b):
            _update(d["id"], status="done", finished_at=storage.utc_now_str())
            continue
        if min(_today(a), _today(b)).isoformat() <= d["end_date"]:
            continue
        va, vb = view(d, a), view(d, b)
        title = f"{html.escape(d['emoji'] or '')} {html.escape(d['title'])}"
        winner = None
        if d["mode"] == "duel":
            sa, sb = va["me"]["score"], vb["me"]["score"]
            winner = a if sa > sb else b if sb > sa else None
            for uid, mine, theirs, rival in ((a, sa, sb, b), (b, sb, sa, a)):
                if winner == uid:
                    won = winner_reward(uid)
                    if won["kind"] == "hat":
                        _update(d["id"], prize=won["id"])
                    head, prize = "🏆 Победа!", html.escape(won["text"])
                else:
                    xp = XP_TIE if winner is None else XP_LOSE
                    head = "🤝 Ничья!" if winner is None else "💪 В этот раз победа у соперника."
                    game.add_xp(uid, xp, "duel", _today(uid).isoformat())
                    prize = f"+{xp} XP"
                messages.append((uid, f"{head}\nДуэль «{title}» с {html.escape(_name(rival))} закончилась: "
                                      f"<b>{mine}:{theirs}</b> из {d['days']} дн.\n{prize}. Реванш? 😉"))
        else:
            joint = va["team"]["joint"]
            perfect = joint == d["days"]
            xp = joint * XP_TEAM_DAY + (XP_TEAM_PERFECT if perfect else 0)
            for uid, rival in ((a, b), (b, a)):
                game.add_xp(uid, xp, "duel_team", _today(uid).isoformat())
                head = "🌟 Идеально — все дни вместе!" if perfect else "🎉 Совместный вызов окончен!"
                messages.append((uid, f"{head}\n«{title}» с {html.escape(_name(rival))}: вместе {joint} из {d['days']} дн.\n"
                                      f"+{xp} XP. Ещё раунд?"))
        _update(d["id"], status="done", winner_id=winner, finished_at=storage.utc_now_str())
    return messages


def habit_badges(user_id: int) -> dict:
    """habit_id → с кем идёт вызов: для значка на карточке привычки."""
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT * FROM habit_duels WHERE status = 'active' AND (creator_id = ? OR opponent_id = ?)""",
                        (user_id, user_id)).fetchall()
    conn.close()
    out = {}
    for r in rows:
        mine = r["creator_id"] == user_id
        hid = r["creator_habit"] if mine else r["opponent_habit"]
        out[str(hid)] = {"duel_id": r["id"], "mode": r["mode"],
                         "with": _name(r["opponent_id"] if mine else r["creator_id"])}
    return out


INVITE_REMIND_HOURS = 24


def invite_reminders() -> list:
    """Вызов другу висит без ответа сутки — напоминаем ему один раз."""
    from datetime import datetime
    border = (datetime.utcnow() - timedelta(hours=INVITE_REMIND_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute("""SELECT * FROM habit_duels WHERE status = 'pending'
                                             AND opponent_id IS NOT NULL AND created_at <= ?""", (border,)).fetchall()]
    conn.close()
    messages = []
    for d in rows:
        if not storage.get_user(d["opponent_id"]) or not _ping(d["id"], d["opponent_id"], "-", "invite"):
            continue
        who = html.escape(_name(d["creator_id"]))
        messages.append((d["opponent_id"], f"⏳ {who} ждёт ответа на вызов «{html.escape(d['emoji'] or '✨')} "
                                           f"{html.escape(d['title'])}». Принять или отказаться — в приложении, "
                                           f"раздел «Друзья»."))
    return messages


EVENING_HOUR = 21


def evening_alerts() -> list:
    """В 21:00 по времени участника: привычка вызова сегодня ещё не сделана — напоминаем."""
    conn = storage.connect(rows=True)
    rows = [dict(r) for r in conn.execute("SELECT * FROM habit_duels WHERE status = 'active'").fetchall()]
    conn.close()
    messages = []
    for d in rows:
        for uid in (d["creator_id"], d["opponent_id"]):
            user = storage.get_user(uid)
            if not user or game.local_now(user).hour != EVENING_HOUR:
                continue
            v = view(d, uid)
            if not v["rival"] or v["me"]["today_done"] or not _ping(d["id"], uid, v["me"]["today"], "evening"):
                continue
            title = f"{html.escape(d['emoji'] or '')} {html.escape(d['title'])}"
            rival = html.escape(v["rival"]["name"] or "Друг")
            if d["mode"] == "team":
                text = (f"🔥 Общая серия с {rival} — {v['team']['streak']} дн. «{title}» сегодня ещё не отмечена — "
                        f"успей до полуночи!")
            else:
                text = (f"⚔️ Дуэль с {rival}: «{title}» сегодня ещё не отмечена. "
                        f"Счёт {v['me']['score']}:{v['rival']['score']} — не сдавайся!")
            messages.append((uid, text))
    return messages

"""Общие челленджи месяца (monthly.py): «Месяц чтения», «Месяц шагов» и т.п.

Каждый челлендж идёт календарный месяц, участвуют все желающие. Участник
каждый день отмечает результат (страницы, шаги, минуты — или просто «сделано»),
видит свой прогресс к цели, таблицу друзей и общий топ.

XP: +XP_DAY за первый отмеченный день, +XP_GOAL при достижении цели (раз в месяц).
"""

import html
from calendar import monthrange
from datetime import date, timedelta

import game
import storage

XP_DAY = 5
XP_GOAL = 100
MAX_VALUE = 100000
TOP_N = 10

# kind: "sum" — суммируем введённые значения; "days" — считаем дни с отметкой
# unit: (1, 2-4, 5+) формы; step — шаги быстрых кнопок; milestone — доп. кнопка-счётчик
CATALOG = [
    {"id": "reading", "emoji": "📚", "title": "Месяц чтения",
     "pitch": "Сколько книг получится прочитать за месяц? Отмечай страницы каждый день.",
     "kind": "sum", "unit": ("страница", "страницы", "страниц"), "goal": 600, "steps": (10, 25, 50),
     "milestone": {"label": "Дочитал(а) книгу", "emoji": "📖", "unit": ("книга", "книги", "книг")}},
    {"id": "steps", "emoji": "🚶", "title": "Месяц шагов",
     "pitch": "Ходим каждый день и считаем шаги. 200 000 за месяц — это всего 6–7 тысяч в день.",
     "kind": "sum", "unit": ("шаг", "шага", "шагов"), "goal": 200000, "steps": (3000, 5000, 10000)},
    {"id": "water", "emoji": "💧", "title": "Месяц воды",
     "pitch": "Стакан за стаканом. Цель — 8 стаканов в день, а в сумме 240 за месяц.",
     "kind": "sum", "unit": ("стакан", "стакана", "стаканов"), "goal": 240, "steps": (1, 2, 4)},
    {"id": "sport", "emoji": "🏃", "title": "Месяц движения",
     "pitch": "Любая тренировка считается: зал, йога, танцы на кухне. Отмечай минуты.",
     "kind": "sum", "unit": ("минута", "минуты", "минут"), "goal": 600, "steps": (15, 30, 60)},
    {"id": "pushups", "emoji": "💪", "title": "1000 отжиманий",
     "pitch": "Тысяча отжиманий за месяц — это 33 в день. Можно с колен, можно подходами.",
     "kind": "sum", "unit": ("отжимание", "отжимания", "отжиманий"), "goal": 1000, "steps": (10, 20, 50)},
    {"id": "words", "emoji": "🇬🇧", "title": "Месяц новых слов",
     "pitch": "Учим иностранные слова. 5 слов в день — и к концу месяца 150 новых.",
     "kind": "sum", "unit": ("слово", "слова", "слов"), "goal": 150, "steps": (3, 5, 10)},
    {"id": "outdoor", "emoji": "🌳", "title": "Час на воздухе",
     "pitch": "Гуляем, а не листаем. Считаем минуты на улице — цель 20 часов за месяц.",
     "kind": "sum", "unit": ("минута", "минуты", "минут"), "goal": 1200, "steps": (20, 40, 60)},
    {"id": "declutter", "emoji": "🧹", "title": "Расхламление",
     "pitch": "Каждый день — несколько вещей вон из дома: выбросить, отдать, продать. 100 за месяц.",
     "kind": "sum", "unit": ("вещь", "вещи", "вещей"), "goal": 100, "steps": (1, 3, 5)},
    {"id": "kindness", "emoji": "💜", "title": "Добрые дела",
     "pitch": "Придержать дверь не считается. Настоящее доброе дело — каждый день.",
     "kind": "sum", "unit": ("дело", "дела", "дел"), "goal": 30, "steps": (1, 2, 3)},
    {"id": "art", "emoji": "🎨", "title": "Месяц творчества",
     "pitch": "Рисуй, пиши, лепи, играй. Минуты творчества — неважно, насколько криво вышло.",
     "kind": "sum", "unit": ("минута", "минуты", "минут"), "goal": 600, "steps": (15, 30, 60)},
    {"id": "early", "emoji": "🌅", "title": "Ранние подъёмы",
     "pitch": "Встал(а) до 7 утра — день засчитан. 20 таких дней за месяц.",
     "kind": "days", "unit": ("день", "дня", "дней"), "goal": 20},
    {"id": "nosugar", "emoji": "🍬", "title": "Без сладкого",
     "pitch": "День без конфет, тортиков и газировки — отметка. Фрукты можно.",
     "kind": "days", "unit": ("день", "дня", "дней"), "goal": 25},
    {"id": "cold", "emoji": "🚿", "title": "Контрастный душ",
     "pitch": "Закончил(а) душ холодной водой — день в зачёт. Бодрит сильнее кофе.",
     "kind": "days", "unit": ("день", "дня", "дней"), "goal": 20},
    {"id": "journal", "emoji": "📝", "title": "Месяц дневника",
     "pitch": "Три строчки о дне перед сном. Через месяц будет что перечитать.",
     "kind": "days", "unit": ("день", "дня", "дней"), "goal": 25},
    {"id": "noscroll", "emoji": "📵", "title": "Вечер без ленты",
     "pitch": "После 21:00 — без соцсетей и новостей. Удалось — отмечай день.",
     "kind": "days", "unit": ("день", "дня", "дней"), "goal": 20},
    {"id": "meditation", "emoji": "🧘", "title": "Месяц тишины",
     "pitch": "Медитация, дыхание или просто 10 минут без экрана. Считаем минуты.",
     "kind": "sum", "unit": ("минута", "минуты", "минут"), "goal": 300, "steps": (5, 10, 20)},
]
BY_ID = {c["id"]: c for c in CATALOG}

MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август",
          "сентябрь", "октябрь", "ноябрь", "декабрь"]


class ChallengeError(game.QuestError):
    pass


def ensure_tables():
    c = storage.connect()
    c.execute("""CREATE TABLE IF NOT EXISTS challenge_members (
        user_id INTEGER NOT NULL, challenge_id TEXT NOT NULL, period TEXT NOT NULL,
        goal INTEGER, joined_at TEXT, goal_awarded INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, challenge_id, period))""")
    c.execute("""CREATE TABLE IF NOT EXISTS challenge_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL, challenge_id TEXT NOT NULL, period TEXT NOT NULL,
        date TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, milestone INTEGER NOT NULL DEFAULT 0,
        created_at TEXT)""")
    c.execute("CREATE INDEX IF NOT EXISTS idx_challenge_log ON challenge_log(challenge_id, period, user_id, date)")
    c.commit()
    c.close()


def plural(n: int, forms) -> str:
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return forms[0]
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return forms[1]
    return forms[2]


def _period(today: date) -> str:
    return today.strftime("%Y-%m")


def period_label(period: str) -> str:
    y, m = period.split("-")
    return MONTHS[int(m) - 1]


def _name(u: dict) -> str:
    return u.get("first_name") or u.get("username") or "Друг"


def _public(u: dict) -> dict:
    return {"id": u["user_id"], "name": _name(u),
            "mascot": game.LEGACY_MASCOTS.get(u.get("mascot"), u.get("mascot")) or "cat-purple",
            "accessory": game.visible_accessory(u)}


def _friend_ids(conn, user_id: int) -> list:
    return [r[0] for r in conn.execute("SELECT friend_id FROM friends WHERE user_id = ?", (user_id,)).fetchall()]


def _totals(conn, cid: str, period: str) -> dict:
    """user_id -> {total, days, milestones} за период."""
    out = {}
    for r in conn.execute("""SELECT user_id, SUM(value) AS total, COUNT(DISTINCT date) AS days, SUM(milestone) AS ms
                             FROM challenge_log WHERE challenge_id = ? AND period = ? GROUP BY user_id""",
                          (cid, period)).fetchall():
        out[r["user_id"]] = {"total": int(r["total"] or 0), "days": int(r["days"] or 0), "milestones": int(r["ms"] or 0)}
    return out


def _score(ch: dict, t: dict) -> int:
    return t["days"] if ch["kind"] == "days" else t["total"]


def _member(conn, user_id: int, cid: str, period: str):
    return conn.execute("SELECT * FROM challenge_members WHERE user_id = ? AND challenge_id = ? AND period = ?",
                        (user_id, cid, period)).fetchone()


def _brief(ch: dict, period: str) -> dict:
    return {"id": ch["id"], "emoji": ch["emoji"], "title": ch["title"], "pitch": ch["pitch"], "kind": ch["kind"],
            "unit": list(ch["unit"]), "goal": ch["goal"], "steps": list(ch.get("steps") or []),
            "milestone": ch.get("milestone") and {"label": ch["milestone"]["label"], "emoji": ch["milestone"]["emoji"],
                                                  "unit": list(ch["milestone"]["unit"])},
            "period": period, "period_label": period_label(period)}


# ---------- список ----------
def list_view(user_id: int) -> dict:
    ensure_tables()
    me = storage.get_user(user_id)
    today = game.local_today(me)
    period = _period(today)
    days_left = monthrange(today.year, today.month)[1] - today.day + 1
    conn = storage.connect(rows=True)
    friends = set(_friend_ids(conn, user_id))
    members = {}
    for r in conn.execute("SELECT user_id, challenge_id, goal FROM challenge_members WHERE period = ?", (period,)).fetchall():
        members.setdefault(r["challenge_id"], {})[r["user_id"]] = r["goal"]
    today_iso = today.isoformat()
    logged_today = {r[0] for r in conn.execute(
        "SELECT DISTINCT challenge_id FROM challenge_log WHERE user_id = ? AND period = ? AND date = ?",
        (user_id, period, today_iso)).fetchall()}
    mine, others = [], []
    for ch in CATALOG:
        m = members.get(ch["id"], {})
        totals = _totals(conn, ch["id"], period) if user_id in m else {}
        item = _brief(ch, period)
        friend_members = [storage.get_user(f) for f in m if f in friends]
        item.update({"joined": user_id in m, "participants": len(m),
                     "friends": [_public(f) for f in friend_members if f][:5],
                     "friends_count": len(friend_members)})
        if user_id in m:
            t = totals.get(user_id, {"total": 0, "days": 0, "milestones": 0})
            goal = m[user_id] or ch["goal"]
            item.update({"my_score": _score(ch, t), "my_goal": goal, "my_days": t["days"],
                         "my_milestones": t["milestones"], "logged_today": ch["id"] in logged_today,
                         "percent": min(100, round(100 * _score(ch, t) / max(1, goal)))})
            mine.append(item)
        else:
            others.append(item)
    conn.close()
    return {"period": period, "period_label": period_label(period), "days_left": days_left,
            "mine": mine, "catalog": others}


# ---------- участие ----------
def join(user_id: int, cid: str) -> dict:
    ensure_tables()
    ch = BY_ID.get(cid)
    if not ch:
        raise ChallengeError("Такого челленджа нет", "not_found")
    me = storage.get_user(user_id)
    period = _period(game.local_today(me))
    conn = storage.connect()
    conn.execute("""INSERT OR IGNORE INTO challenge_members (user_id, challenge_id, period, goal, joined_at)
                    VALUES (?, ?, ?, ?, ?)""", (user_id, cid, period, ch["goal"], storage.utc_now_str()))
    conn.commit()
    conn.close()
    return detail(user_id, cid)


def leave(user_id: int, cid: str) -> dict:
    ensure_tables()
    me = storage.get_user(user_id)
    period = _period(game.local_today(me))
    conn = storage.connect()
    conn.execute("DELETE FROM challenge_members WHERE user_id = ? AND challenge_id = ? AND period = ?", (user_id, cid, period))
    conn.commit()
    conn.close()
    return {"ok": True}


def set_goal(user_id: int, cid: str, goal: int) -> dict:
    ensure_tables()
    ch = BY_ID.get(cid)
    if not ch:
        raise ChallengeError("Такого челленджа нет", "not_found")
    try:
        goal = int(goal)
    except (TypeError, ValueError):
        raise ChallengeError("Цель — число", "bad_goal")
    if not 1 <= goal <= MAX_VALUE * 10:
        raise ChallengeError("Цель — от 1 и в разумных пределах", "bad_goal")
    me = storage.get_user(user_id)
    period = _period(game.local_today(me))
    conn = storage.connect()
    conn.execute("UPDATE challenge_members SET goal = ? WHERE user_id = ? AND challenge_id = ? AND period = ?",
                 (goal, user_id, cid, period))
    conn.commit()
    conn.close()
    return detail(user_id, cid)


# ---------- отметки ----------
def log(user_id: int, cid: str, value=0, milestone: bool = False) -> dict:
    ensure_tables()
    ch = BY_ID.get(cid)
    if not ch:
        raise ChallengeError("Такого челленджа нет", "not_found")
    me = storage.get_user(user_id)
    today = game.local_today(me)
    period = _period(today)
    today_iso = today.isoformat()
    if ch["kind"] == "days":
        value = 1
    else:
        try:
            value = int(value or 0)
        except (TypeError, ValueError):
            raise ChallengeError("Нужно число", "bad_value")
        if value < 0 or value > MAX_VALUE:
            raise ChallengeError("Слишком большое число — проверь, пожалуйста", "bad_value")
        if not value and not milestone:
            raise ChallengeError("Введи, сколько получилось сегодня", "bad_value")
    if milestone and not ch.get("milestone"):
        milestone = False
    conn = storage.connect(rows=True)
    m = _member(conn, user_id, cid, period)
    if not m:
        conn.execute("""INSERT OR IGNORE INTO challenge_members (user_id, challenge_id, period, goal, joined_at)
                        VALUES (?, ?, ?, ?, ?)""", (user_id, cid, period, ch["goal"], storage.utc_now_str()))
        m = _member(conn, user_id, cid, period)
    messages = []
    xp = 0
    first_today = not conn.execute("SELECT 1 FROM challenge_log WHERE user_id = ? AND challenge_id = ? AND period = ? AND date = ?",
                                   (user_id, cid, period, today_iso)).fetchone()
    if ch["kind"] == "days" and not first_today:
        conn.close()
        raise ChallengeError("Сегодня уже отмечено ✓", "already")
    conn.execute("""INSERT INTO challenge_log (user_id, challenge_id, period, date, value, milestone, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                 (user_id, cid, period, today_iso, value, 1 if milestone else 0, storage.utc_now_str()))
    if first_today:
        xp += XP_DAY
    t = _totals(conn, cid, period).get(user_id, {"total": 0, "days": 0, "milestones": 0})
    goal = m["goal"] or ch["goal"]
    goal_reached = False
    if _score(ch, t) >= goal and not m["goal_awarded"]:
        conn.execute("UPDATE challenge_members SET goal_awarded = 1 WHERE user_id = ? AND challenge_id = ? AND period = ?",
                     (user_id, cid, period))
        xp += XP_GOAL
        goal_reached = True
        # друзьям-участникам — весточка
        name = html.escape(_name(me))
        for fid in _friend_ids(conn, user_id):
            if _member(conn, fid, cid, period):
                messages.append((fid, f"{ch['emoji']} <b>{name}</b> дошёл(ла) до цели в челлендже «{ch['title']}»! "
                                      f"Как у тебя дела?"))
    conn.commit()
    conn.close()
    if xp:
        game.add_xp(user_id, xp, f"challenge:{cid}", today_iso)
    out = detail(user_id, cid)
    out.update({"xp": xp, "goal_reached": goal_reached, "messages": messages})
    return out


def undo(user_id: int, cid: str) -> dict:
    ensure_tables()
    me = storage.get_user(user_id)
    today = game.local_today(me)
    period = _period(today)
    conn = storage.connect(rows=True)
    r = conn.execute("""SELECT id FROM challenge_log WHERE user_id = ? AND challenge_id = ? AND period = ? AND date = ?
                        ORDER BY id DESC LIMIT 1""", (user_id, cid, period, today.isoformat())).fetchone()
    if r:
        conn.execute("DELETE FROM challenge_log WHERE id = ?", (r["id"],))
        conn.commit()
    conn.close()
    return detail(user_id, cid)


# ---------- карточка ----------
def detail(user_id: int, cid: str, period: str = None) -> dict:
    ensure_tables()
    ch = BY_ID.get(cid)
    if not ch:
        raise ChallengeError("Такого челленджа нет", "not_found")
    me = storage.get_user(user_id)
    today = game.local_today(me)
    period = period or _period(today)
    y, mo = (int(x) for x in period.split("-"))
    ndays = monthrange(y, mo)[1]
    conn = storage.connect(rows=True)
    m = _member(conn, user_id, cid, period)
    totals = _totals(conn, cid, period)
    members = [r["user_id"] for r in conn.execute("SELECT user_id FROM challenge_members WHERE challenge_id = ? AND period = ?",
                                                  (cid, period)).fetchall()]
    friends = set(_friend_ids(conn, user_id))
    # мои дни
    series = {}
    for r in conn.execute("""SELECT date, SUM(value) AS v, SUM(milestone) AS ms FROM challenge_log
                             WHERE user_id = ? AND challenge_id = ? AND period = ? GROUP BY date""",
                          (user_id, cid, period)).fetchall():
        series[r["date"]] = {"value": int(r["v"] or 0), "milestones": int(r["ms"] or 0)}
    days = []
    for d in range(1, ndays + 1):
        iso = date(y, mo, d).isoformat()
        s = series.get(iso)
        days.append({"date": iso, "day": d, "value": s["value"] if s else 0, "done": bool(s),
                     "future": date(y, mo, d) > today})
    today_entries = conn.execute("""SELECT value, milestone FROM challenge_log WHERE user_id = ? AND challenge_id = ?
                                    AND period = ? AND date = ? ORDER BY id""", (user_id, cid, period, today.isoformat())).fetchall()
    # таблица
    def row(uid):
        u = storage.get_user(uid)
        if not u:
            return None
        t = totals.get(uid, {"total": 0, "days": 0, "milestones": 0})
        return {**_public(u), "score": _score(ch, t), "days": t["days"], "milestones": t["milestones"],
                "me": uid == user_id, "friend": uid in friends}
    board = [r for r in (row(uid) for uid in members) if r]
    board.sort(key=lambda r: (-r["score"], -r["days"], r["name"]))
    for i, r in enumerate(board):
        r["rank"] = i + 1
    friends_board = [r for r in board if r["me"] or r["friend"]]
    my_row = next((r for r in board if r["me"]), None)
    conn.close()
    t = totals.get(user_id, {"total": 0, "days": 0, "milestones": 0})
    goal = (m["goal"] if m and m["goal"] else ch["goal"])
    score = _score(ch, t)
    out = _brief(ch, period)
    out.update({
        "joined": bool(m), "participants": len(members), "days_left": max(0, ndays - today.day + 1) if period == _period(today) else 0,
        "my": {"score": score, "goal": goal, "days": t["days"], "milestones": t["milestones"],
               "percent": min(100, round(100 * score / max(1, goal))), "goal_reached": score >= goal,
               "today": sum(int(e["value"]) for e in today_entries), "today_entries": len(today_entries),
               "logged_today": bool(today_entries), "rank": my_row["rank"] if my_row else None},
        "days": days, "friends_board": friends_board, "top": board[:TOP_N],
        "score_label": plural(score, ch["unit"]),
    })
    return out


def today_nudges(user_id: int) -> list:
    """Челленджи, в которых участвую, но сегодня ещё не отметился (для главной)."""
    ensure_tables()
    me = storage.get_user(user_id)
    if not me:
        return []
    today = game.local_today(me)
    period = _period(today)
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT m.challenge_id FROM challenge_members m
                           WHERE m.user_id = ? AND m.period = ? AND NOT EXISTS (
                             SELECT 1 FROM challenge_log l WHERE l.user_id = m.user_id AND l.challenge_id = m.challenge_id
                             AND l.period = m.period AND l.date = ?)""", (user_id, period, today.isoformat())).fetchall()
    conn.close()
    out = []
    for r in rows:
        ch = BY_ID.get(r["challenge_id"])
        if ch:
            out.append({"id": ch["id"], "emoji": ch["emoji"], "title": ch["title"], "kind": ch["kind"], "unit": list(ch["unit"])})
    return out

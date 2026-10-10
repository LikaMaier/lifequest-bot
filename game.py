# ============================================================
# LIFEQUEST — игровая логика
# XP и уровни, серия (с заморозкой раз в неделю), выбор случайного задания
# без повторов, задание дня, ачивки, статистика, награды карты недели.
# Используется и ботом (выполнение из чата), и API мини-аппа — поэтому XP,
# серия и ачивки общие для обоих путей.
# ============================================================

import hashlib
import random
from collections import Counter
from datetime import date, datetime, timedelta

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

import storage
from quests_database import CATALOG, KEY_TO_TASK, BINGO_SPHERES

MODES = ("solo", "pair", "company")
MODE_LABELS = {"solo": "Для себя", "pair": "Для двоих", "company": "Для компании"}

# ==================== ВРЕМЯ ПОЛЬЗОВАТЕЛЯ ====================
def valid_tz(name: str) -> bool:
    if not name or not ZoneInfo or len(name) > 64:
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False


def local_now(user: dict) -> datetime:
    """Время пользователя (наивное). Без часового пояса — время сервера."""
    tz = (user or {}).get("tz")
    if tz and valid_tz(tz):
        return datetime.now(ZoneInfo(tz)).replace(tzinfo=None)
    return datetime.now()


def local_today(user: dict) -> date:
    return local_now(user).date()


# ==================== УРОВНИ ====================
LEVELS = [
    (0, "Новичок"),
    (60, "Первые шаги"),
    (150, "Вкус приключений"),
    (300, "Исследование мира"),
    (500, "Охота за впечатлениями"),
    (750, "Смелая душа"),
    (1100, "Мастер квестов"),
    (1500, "Легенда района"),
    (2000, "Коллекция историй"),
    (2700, "Звезда LifeQuest"),
]
LEVEL_STEP_AFTER_MAX = 800

# Награды за уровни: маскоты и акцентные цвета (уровень, с которого доступны).
MASCOTS = [
    ("cat-purple", "Сирень", 1), ("star", "Звёздочка", 1), ("frog", "Лягушонок", 2),
    ("puppy", "Щенок", 3), ("bear", "Медвежонок", 4), ("leopard", "Леопард", 5),
    ("panda", "Панда", 6), ("pig", "Свинка", 7),
]
# Маскоты до обновления → их замена того же уровня (миграция в storage).
LEGACY_MASCOTS = {"cat-blue": "frog", "heart": "puppy", "cat-orange": "bear",
                  "cat-lav": "leopard", "cat-pink2": "panda", "cat-lime": "pig"}
# Стили приложения — доступны все и сразу, независимо от уровня.
THEMES = [
    ("classic", "Классика", "Кремовый фон, стикеры и пастель — как всегда"),
    ("pixel", "8-bit", "Пиксели, ретро-шрифт и падающие фигурки"),
    ("halloween", "Хэллоуин", "Тыквы, летучие мыши и фиолетовая ночь"),
    ("matrix", "Матрица", "Зелёный код на чёрном. Следуй за белым кроликом"),
    ("forest", "Лес", "Солнечная поляна, мох и падающие листья"),
    ("ocean", "Морской мир", "Песок, бирюза, стеклянные плашки и пузырьки"),
]
THEME_IDS = {t[0] for t in THEMES}


def level_threshold(level: int) -> int:
    if level <= len(LEVELS):
        return LEVELS[level - 1][0]
    return LEVELS[-1][0] + LEVEL_STEP_AFTER_MAX * (level - len(LEVELS))


def level_name(level: int) -> str:
    if level <= len(LEVELS):
        return LEVELS[level - 1][1]
    return f"{LEVELS[-1][1]} ★{level - len(LEVELS) + 1}"


def level_for_xp(xp: int) -> int:
    level = 1
    while xp >= level_threshold(level + 1):
        level += 1
    return level


def level_info(xp: int) -> dict:
    xp = max(0, int(xp or 0))
    level = level_for_xp(xp)
    floor, nxt = level_threshold(level), level_threshold(level + 1)
    return {
        "level": level, "name": level_name(level), "xp": xp,
        "floor": floor, "next": nxt, "next_name": level_name(level + 1),
        "progress": round((xp - floor) / (nxt - floor), 4),
    }


def unlocks(level: int) -> dict:
    return {
        "mascots": [{"id": k, "name": n, "level": lv, "unlocked": level >= lv} for k, n, lv in MASCOTS],
        "themes": [{"id": k, "name": n, "description": d} for k, n, d in THEMES],
    }


# ==================== СЕРИЯ ====================
def week_key(day: date) -> str:
    return storage.week_key_for(day)


def _missed_days(last: str, today: date) -> int:
    try:
        return (today - date.fromisoformat(last)).days - 1
    except (TypeError, ValueError):
        return -1


def advance_streak(current: int, best: int, last: str, freeze_week: str, today: date, tokens: int = 0):
    """Новое состояние серии после выполнения задания сегодня.
    Возвращает (current, best, freeze_week, used_freeze, tokens_used).
    Заморозка: один пропущенный день в неделю бесплатно; каждый следующий
    пропущенный день закрывает купленная в магазине заморозка (tokens)."""
    current, best, tokens = current or 0, best or 0, max(0, tokens or 0)
    t = today.isoformat()
    if last == t:
        return current, max(best, current), freeze_week, False, 0
    missed = _missed_days(last, today)
    weekly = 1 if freeze_week != week_key(today) else 0
    if missed == 0:
        current += 1
        return current, max(best, current), freeze_week, False, 0
    if current > 0 and 1 <= missed <= weekly + tokens:
        tokens_used = missed - weekly
        if weekly:
            freeze_week = week_key(today)
        current += 1
        return current, max(best, current), freeze_week, True, tokens_used
    return 1, max(best, 1), freeze_week, False, 0


def streak_view(current: int, best: int, last: str, freeze_week: str, today: date, tokens: int = 0) -> dict:
    """Серия для показа: done — сегодня уже засчитано; at_risk — вчера было,
    сегодня ещё нет; freeze — пропущены дни, но заморозки спасут;
    lost — серия прервалась; none — серии нет."""
    current, best, tokens = current or 0, best or 0, max(0, tokens or 0)
    freeze_available = freeze_week != week_key(today)
    missed = _missed_days(last, today)
    if last == today.isoformat():
        status, value = "done", current
    elif missed == 0:
        status, value = "at_risk", current
    elif current > 0 and 1 <= missed <= (1 if freeze_available else 0) + tokens:
        status, value = "freeze", current
    elif current >= 2:
        status, value = "lost", 0
    else:
        status, value = "none", 0
    return {"current": value, "best": max(best, value), "status": status,
            "freeze_available": freeze_available, "freeze_tokens": tokens,
            "lost_value": current if status == "lost" else 0}


# ==================== XP ====================
BASE_XP = {("solo", "easy"): 10, ("solo", "medium"): 20, ("pair", None): 20, ("company", None): 25}
BRAVE_SPHERE = "Смелость"
BRAVE_BONUS = 10
SAME_DAY_BONUS = 5
DAILY_BONUS = 15
STREAK_BONUS_PER_DAY = 2
STREAK_BONUS_MAX = 20
BOARD_CELL_XP = 3
BOARD_LINE_XP = 8
BOARD_FULL_XP = 30


def quest_xp(mode: str, tier: str, sphere: str, same_day: bool, daily: bool,
             streak: int, first_today: bool) -> list:
    """Разбивка XP за выполнение: [(подпись, xp), ...]."""
    if mode == "solo":
        base = BASE_XP[("solo", "easy" if tier == "easy" else "medium")]
    else:
        base = BASE_XP.get((mode, None), 15)
    parts = [("Задание", base)]
    if sphere == BRAVE_SPHERE:
        parts.append(("Смелость", BRAVE_BONUS))
    if same_day:
        parts.append(("В тот же день", SAME_DAY_BONUS))
    if daily:
        parts.append(("Задание дня", DAILY_BONUS))
    if first_today and streak > 1:
        parts.append((f"Серия {streak} дн.", min(streak * STREAK_BONUS_PER_DAY, STREAK_BONUS_MAX)))
    return parts


def add_xp(user_id: int, amount: int, reason: str, local_date: str):
    if amount <= 0:
        return
    conn = storage.connect()
    conn.execute("UPDATE users SET xp = COALESCE(xp, 0) + ? WHERE user_id = ?", (amount, user_id))
    conn.execute("INSERT INTO xp_log (user_id, amount, reason, local_date, created_at) VALUES (?, ?, ?, ?, ?)",
                 (user_id, amount, reason, local_date, storage.utc_now_str()))
    conn.commit()
    conn.close()


# ==================== ЗАДАНИЯ ====================
class QuestError(Exception):
    """Ошибка, которую можно показать пользователю как есть."""


DAILY_ROLL_LIMIT = 40
DAILY_ROLL_LIMIT_PREMIUM = 200
RECENT_OFFERS = 30  # сколько последних выпавших заданий режима не повторять


def public_quest(q: dict, tier: str = None) -> dict:
    tier = tier if tier in q["tiers"] else ("medium" if "medium" in q["tiers"] else next(iter(q["tiers"])))
    return {
        "id": q["id"], "mode": q["mode"], "sphere": q["sphere"], "emoji": q["emoji"],
        "title": q["title"], "text": q["tiers"][tier], "tier": tier,
        "tiers": list(q["tiers"].keys()), "why": q["why"], "outcome": q["outcome"],
    }


def daily_quest_id(day: date) -> str:
    """Задание дня — общее для всех, детерминированное по дате."""
    pool = sorted(k for k, q in CATALOG.items() if q["mode"] == "solo")
    idx = int(hashlib.sha256(f"lifequest-daily-{day.isoformat()}".encode()).hexdigest(), 16) % len(pool)
    return pool[idx]


def daily_status(user_id: int, day: date) -> str:
    """Статус задания дня у пользователя за этот день: None, 'active' или 'done'."""
    conn = storage.connect()
    row = conn.execute("""SELECT status FROM quest_history WHERE user_id = ? AND quest_key = ? AND daily = 1
                          AND local_date = ? ORDER BY id DESC LIMIT 1""",
                       (user_id, daily_quest_id(day), day.isoformat())).fetchone()
    conn.close()
    return row[0] if row else None


def _keys_with_status(user_id: int, status: str) -> set:
    conn = storage.connect()
    rows = conn.execute("SELECT DISTINCT quest_key FROM quest_history WHERE user_id = ? AND status = ?",
                        (user_id, status)).fetchall()
    conn.close()
    return {r[0] for r in rows}


def _active_keys(user_id: int) -> set:
    return {row[1] for row in storage.get_active_quests(user_id)}


def _recent_offer_keys(user_id: int, mode: str, limit: int = RECENT_OFFERS) -> set:
    conn = storage.connect()
    rows = conn.execute("SELECT quest_key FROM quest_offers WHERE user_id = ? AND mode = ? ORDER BY id DESC LIMIT ?",
                        (user_id, mode, limit)).fetchall()
    conn.close()
    return {r[0] for r in rows}


def rolls_today(user_id: int, today: date) -> int:
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM quest_offers WHERE user_id = ? AND local_date = ?",
                     (user_id, today.isoformat())).fetchone()[0]
    conn.close()
    return n


def roll_limit(user: dict) -> int:
    return DAILY_ROLL_LIMIT_PREMIUM if user.get("is_premium") else DAILY_ROLL_LIMIT


def choose_quest(pool: list, done: set, active: set, recent: set, rng=random) -> dict:
    """Сначала исключаем выполненные, активные и недавно выпадавшие; если всё
    уже было — постепенно ослабляем фильтр, чтобы задание выпало всегда."""
    for excluded in (done | active | recent, done | active, active, set()):
        candidates = [q for q in pool if q["id"] not in excluded]
        if candidates:
            return rng.choice(candidates)
    raise QuestError("Заданий пока нет")


def random_quest(user_id: int, mode: str, sphere: str = None, rng=random) -> dict:
    if mode not in MODES:
        raise QuestError("Неизвестный режим")
    if sphere and (mode != "solo" or sphere not in BINGO_SPHERES):
        sphere = None
    user = storage.get_user(user_id)
    today = local_today(user)
    if rolls_today(user_id, today) >= roll_limit(user):
        raise QuestError("На сегодня попытки закончились — загляни завтра или возьми задание из избранного 💛")
    pool = [q for q in CATALOG.values() if q["mode"] == mode and (not sphere or q["sphere"] == sphere)]
    q = choose_quest(pool, _keys_with_status(user_id, "done"), _active_keys(user_id),
                     _recent_offer_keys(user_id, mode), rng)
    tier = rng.choice(list(q["tiers"].keys()))
    conn = storage.connect()
    conn.execute("INSERT INTO quest_offers (user_id, quest_key, mode, local_date, offered_at) VALUES (?, ?, ?, ?, ?)",
                 (user_id, q["id"], mode, today.isoformat(), storage.utc_now_str()))
    # таблица предложений растёт — храним только последние 300 на пользователя
    conn.execute("""DELETE FROM quest_offers WHERE user_id = ? AND id NOT IN (
                        SELECT id FROM quest_offers WHERE user_id = ? ORDER BY id DESC LIMIT 300)""",
                 (user_id, user_id))
    conn.commit()
    conn.close()
    result = public_quest(q, tier)
    result["rolls_left"] = max(0, roll_limit(user) - rolls_today(user_id, today))
    result["favorite"] = q["id"] in favorite_keys(user_id)
    return result


def _bot_task_text(q: dict, tier: str) -> str:
    """Текст для active_quests в том же виде, что сохранял бот: у одиночных —
    HTML уровня сложности, у парных/компанейских — название с эмодзи."""
    if q["mode"] == "solo":
        raw = KEY_TO_TASK.get(q["id"], {})
        return raw.get(tier) or raw.get("medium") or q["title"]
    return f"{q['emoji']} {q['title']}".strip()


def accept_quest(user_id: int, quest_id: str, tier: str = None, daily: bool = False) -> dict:
    q = CATALOG.get(quest_id)
    if not q:
        raise QuestError("Это задание больше недоступно")
    user = storage.get_user(user_id)
    today = local_today(user)
    daily = bool(daily) and quest_id == daily_quest_id(today)
    tier = tier if tier in q["tiers"] else ("medium" if "medium" in q["tiers"] else next(iter(q["tiers"])))

    for active_id, key, _text, _taken in storage.get_active_quests(user_id):
        if key == quest_id:
            return {"active_id": active_id, "already": True, "new_achievements": []}

    active_id = storage.save_active_quest(user_id, quest_id, _bot_task_text(q, tier),
                                          mode=q["mode"], sphere=q["sphere"], tier=tier, daily=daily)
    conn = storage.connect()
    conn.execute("""
        INSERT INTO quest_history (user_id, quest_key, mode, sphere, title, tier, status, daily,
                                   active_quest_id, accepted_at, local_date)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    """, (user_id, quest_id, q["mode"], q["sphere"], q["title"], tier, 1 if daily else 0,
          active_id, storage.utc_now_str(), today.isoformat()))
    conn.commit()
    conn.close()
    return {"active_id": active_id, "already": False, "new_achievements": check_achievements(user_id)}


def _history_for_active(conn, user_id: int, active_id: int, key: str, text: str):
    row = conn.execute("SELECT * FROM quest_history WHERE user_id = ? AND active_quest_id = ? AND status = 'active'",
                       (user_id, active_id)).fetchone()
    if row:
        return dict(row)
    # Квест был принят до мини-аппа v2 и не попал в историю — создаём запись.
    q = CATALOG.get(key) or {}
    cur = conn.execute("""
        INSERT INTO quest_history (user_id, quest_key, mode, sphere, title, status, active_quest_id, accepted_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    """, (user_id, key, q.get("mode"), q.get("sphere"), storage._title_for(key, text), active_id,
          storage.utc_now_str()))
    return dict(conn.execute("SELECT * FROM quest_history WHERE id = ?", (cur.lastrowid,)).fetchone())


def complete_quest(user_id: int, active_id: int):
    """Выполнение принятого задания. None — если его уже нет (закрыто в
    другом окне). Иначе — XP, серия, новый уровень и новые ачивки."""
    row = storage.get_active_quest(user_id, active_id)
    if not row:
        return None
    _id, key, text = row
    user = storage.get_user(user_id)
    now = local_now(user)
    today = now.date()
    level_before = level_for_xp(user.get("xp") or 0)

    conn = storage.connect(rows=True)
    hist = _history_for_active(conn, user_id, active_id, key, text)
    first_today = conn.execute(
        "SELECT COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done' AND local_date = ?",
        (user_id, today.isoformat())).fetchone()[0] == 0
    conn.commit()
    conn.close()

    tokens = user.get("freeze_tokens") or 0
    streak, best, freeze_week, used_freeze, tokens_used = advance_streak(
        user.get("streak_current"), user.get("streak_best"), user.get("streak_last_date"),
        user.get("freeze_week"), today, tokens)
    storage.update_user(user_id, streak_current=streak, streak_best=best,
                        streak_last_date=today.isoformat(), freeze_week=freeze_week,
                        freeze_tokens=tokens - tokens_used)

    accepted_local = hist.get("local_date")
    same_day = accepted_local == today.isoformat()
    parts = quest_xp(hist.get("mode") or "solo", hist.get("tier"), hist.get("sphere"),
                     same_day, bool(hist.get("daily")), streak, first_today)
    xp = sum(v for _, v in parts)

    storage.remove_active_quest(user_id, active_id)
    storage.save_completed_task(user_id, key, text)
    conn = storage.connect()
    conn.execute("""UPDATE quest_history SET status = 'done', completed_at = ?, local_date = ?, local_hour = ?, xp = ?
                    WHERE id = ?""",
                 (storage.utc_now_str(), today.isoformat(), now.hour, xp, hist["id"]))
    conn.commit()
    conn.close()
    add_xp(user_id, xp, f"quest:{key}", today.isoformat())
    storage.touch_activity(user_id)

    xp_total = (user.get("xp") or 0) + xp
    level_after = level_for_xp(xp_total)
    return {
        "history_id": hist["id"], "title": hist.get("title") or "",
        "xp": xp, "breakdown": [{"label": label, "xp": v} for label, v in parts],
        "streak": streak, "used_freeze": used_freeze,
        "level_up": level_info(xp_total) if level_after > level_before else None,
        "new_achievements": check_achievements(user_id),
    }


def skip_quest(user_id: int, active_id: int) -> bool:
    row = storage.get_active_quest(user_id, active_id)
    if not row:
        return False
    storage.remove_active_quest(user_id, active_id)
    conn = storage.connect()
    conn.execute("UPDATE quest_history SET status = 'skipped', skipped_at = ? WHERE user_id = ? AND active_quest_id = ? AND status = 'active'",
                 (storage.utc_now_str(), user_id, active_id))
    conn.commit()
    conn.close()
    return True


def active_quests_view(user_id: int) -> list:
    conn = storage.connect(rows=True)
    rows = conn.execute("""
        SELECT a.id, a.task_key, a.task_text, a.taken_at, a.tier, a.daily
        FROM active_quests a WHERE a.user_id = ? ORDER BY a.taken_at
    """, (user_id,)).fetchall()
    conn.close()
    result = []
    for r in rows:
        q = CATALOG.get(r["task_key"])
        if q:
            item = public_quest(q, r["tier"])
        else:
            item = {"id": r["task_key"], "mode": None, "sphere": None, "emoji": "📌",
                    "title": storage._title_for(r["task_key"], r["task_text"]),
                    "text": storage._TAG_RE.sub("", r["task_text"] or ""), "tier": None,
                    "tiers": [], "why": None, "outcome": None}
        item.update({"active_id": r["id"], "taken_at": r["taken_at"], "daily": bool(r["daily"])})
        result.append(item)
    return result


# ==================== ИЗБРАННОЕ ====================
FAVORITES_LIMIT = 100


def favorite_keys(user_id: int) -> set:
    conn = storage.connect()
    rows = conn.execute("SELECT quest_key FROM favorites WHERE user_id = ?", (user_id,)).fetchall()
    conn.close()
    return {r[0] for r in rows}


def set_favorite(user_id: int, quest_id: str, on: bool) -> dict:
    if quest_id not in CATALOG:
        raise QuestError("Это задание больше недоступно")
    conn = storage.connect()
    if on:
        n = conn.execute("SELECT COUNT(*) FROM favorites WHERE user_id = ?", (user_id,)).fetchone()[0]
        if n >= FAVORITES_LIMIT:
            conn.close()
            raise QuestError("В избранном уже 100 заданий — освободи место 🙂")
        conn.execute("INSERT OR IGNORE INTO favorites (user_id, quest_key, added_at) VALUES (?, ?, ?)",
                     (user_id, quest_id, storage.utc_now_str()))
    else:
        conn.execute("DELETE FROM favorites WHERE user_id = ? AND quest_key = ?", (user_id, quest_id))
    conn.commit()
    conn.close()
    return {"favorite": on, "new_achievements": check_achievements(user_id) if on else []}


def favorites_view(user_id: int) -> list:
    conn = storage.connect()
    rows = conn.execute("SELECT quest_key FROM favorites WHERE user_id = ? ORDER BY added_at DESC", (user_id,)).fetchall()
    conn.close()
    return [public_quest(CATALOG[r[0]]) for r in rows if r[0] in CATALOG]


# ==================== АЧИВКИ ====================
# (code, title, how-to, icon, color, metric, target)
ACHIEVEMENTS = [
    ("first_quest", "Первый шаг", "Выполни первое задание", "🌱", "lime", "total", 1),
    ("done_10", "Разогрев", "Выполни 10 заданий", "🔥", "orange", "total", 10),
    ("done_50", "В ударе", "Выполни 50 заданий", "⚡", "yellow", "total", 50),
    ("done_100", "Сотня приключений", "Выполни 100 заданий", "💯", "red", "total", 100),
    ("streak_3", "Три дня подряд", "Держи серию 3 дня", "🕯️", "orange", "streak_best", 3),
    ("streak_7", "Неделя огня", "Держи серию 7 дней", "🔥", "red", "streak_best", 7),
    ("streak_14", "Две недели в деле", "Держи серию 14 дней", "🌋", "pink", "streak_best", 14),
    ("streak_30", "Месяц без пауз", "Держи серию 30 дней", "👑", "purple", "streak_best", 30),
    ("all_spheres", "Все грани", "Закрой задания во всех 6 сферах", "🌈", "lav", "spheres", 6),
    ("board_line", "Первая линия", "Собери линию на карте недели", "➖", "blue", "board_lines", 1),
    ("board_full", "Бинго!", "Закрой всю карту недели", "🎉", "pink", "board_full", 1),
    ("board_full_4", "Карта покорена", "Закрой карту недели 4 раза", "🗺️", "purple", "board_full", 4),
    ("pair_first", "Вдвоём веселее", "Выполни задание для двоих", "💞", "pink", "pair", 1),
    ("pair_10", "Идеальная пара", "Выполни 10 заданий для двоих", "💘", "red", "pair", 10),
    ("company_first", "Душа компании", "Выполни задание для компании", "👯", "orange", "company", 1),
    ("company_10", "Заводила", "Выполни 10 заданий для компании", "🎊", "yellow", "company", 10),
    ("social_25", "Социальная бабочка", "25 заданий вдвоём или с компанией", "🦋", "lav", "social", 25),
    ("early_bird", "Ранняя пташка", "Выполни задание до 9 утра", "🌅", "yellow", "early", 1),
    ("night_owl", "Ночная сова", "Выполни задание после 23:00", "🦉", "purple", "night", 1),
    ("book_day", "Книга за день", "Проживи день как целую книгу: 3 задания за сутки", "📖", "blue", "max_day", 3),
    ("comeback", "Снова в деле!", "Вернись к заданиям после перерыва в 14+ дней", "🪃", "lime", "comeback", 1),
    ("brave_5", "Смелое сердце", "5 заданий из сферы «Смелость»", "🦁", "red", "sphere:Смелость", 5),
    ("creative_10", "Муза", "10 заданий из сферы «Творчество»", "🎨", "pink", "sphere:Творчество", 10),
    ("adventure_10", "Дух странствий", "10 заданий из сферы «Приключения»", "🧭", "orange", "sphere:Приключения", 10),
    ("discipline_5", "Железная воля", "5 заданий из сферы «Дисциплина»", "🛡️", "blue", "sphere:Дисциплина", 5),
    ("energy_5", "Батарейка", "5 заданий из сферы «Энергия»", "🔋", "lime", "sphere:Энергия", 5),
    ("growth_5", "Тяга к знаниям", "5 заданий из сферы «Саморазвитие»", "📚", "purple", "sphere:Саморазвитие", 5),
    ("daily_1", "Задание дня", "Выполни задание дня", "☀️", "yellow", "daily", 1),
    ("daily_7", "В ритме дня", "Выполни 7 заданий дня", "🗓️", "orange", "daily", 7),
    ("weekend_5", "Выходные с пользой", "5 заданий в выходные", "🛼", "lav", "weekend", 5),
    ("favorites_5", "Коллекция идей", "Сохрани 5 заданий в избранное", "💛", "yellow", "favorites", 5),
    ("picky_50", "Привереда", "Посмотри 50 случайных заданий", "🎲", "blue", "offers", 50),
    ("multitask", "Многозадачность", "Держи 5 принятых заданий одновременно", "🤹", "orange", "active_now", 5),
    ("level_5", "Пятый уровень", "Дойди до 5 уровня", "⭐", "lime", "level", 5),
    ("level_10", "На вершине", "Дойди до 10 уровня", "🏆", "pink", "level", 10),
    ("days_30", "30 дней с LifeQuest", "Выполняй задания в 30 разных дней", "📅", "blue", "active_days", 30),
    ("habit_creator", "Архитектор привычек", "Придумай 3 своих привычки", "🧩", "blue", "habits_created", 3),
    ("habit_first", "Хорошая привычка", "Выполни дневную цель по любой привычке", "✅", "lime", "habit_done", 1),
    ("habit_streak_7", "Привычка закрепилась", "Держи любую привычку 7 дней подряд", "🌿", "lime", "habit_streak", 7),
    ("habit_streak_21", "21 день", "Держи любую привычку 21 день подряд", "🌳", "purple", "habit_streak", 21),
    ("photo_first", "Первое фото-воспоминание", "Прикрепи первое фото", "📷", "pink", "photos", 1),
    ("photo_reports_10", "10 фото-отчётов", "Прикрепи фото к 10 выполненным заданиям", "🖼️", "orange", "photo_reports", 10),
    ("photo_streak_7", "Фото за 7 дней подряд", "Добавляй фото 7 дней подряд", "🎞️", "purple", "photo_streak", 7),
    ("photo_month", "Альбом месяца", "Собери 15 фото за один месяц", "📔", "lav", "photo_month", 15),
    ("plan_first", "Всё по плану", "Выполни запланированное в календаре", "🗓️", "blue", "plans_done", 1),
]
ACHIEVEMENT_BY_CODE = {a[0]: a for a in ACHIEVEMENTS}


def achievement_metrics(user_id: int) -> dict:
    user = storage.get_user(user_id)
    conn = storage.connect(rows=True)
    done = conn.execute("""SELECT mode, sphere, local_date, local_hour, daily FROM quest_history
                           WHERE user_id = ? AND status = 'done'""", (user_id,)).fetchall()
    board = conn.execute("SELECT kind FROM board_awards WHERE user_id = ?", (user_id,)).fetchall()
    favorites = conn.execute("SELECT COUNT(*) FROM favorites WHERE user_id = ?", (user_id,)).fetchone()[0]
    offers = conn.execute("SELECT COUNT(*) FROM quest_offers WHERE user_id = ?", (user_id,)).fetchone()[0]
    active_now = conn.execute("SELECT COUNT(*) FROM active_quests WHERE user_id = ?", (user_id,)).fetchone()[0]
    habits_created = conn.execute("SELECT COUNT(*) FROM habits WHERE user_id = ?", (user_id,)).fetchone()[0]
    photo_rows = conn.execute("""SELECT target_type, quest_history_id, COALESCE(day, plan_date, substr(created_at, 1, 10))
                                 FROM photos WHERE user_id = ?""", (user_id,)).fetchall()
    plans_done = conn.execute("SELECT COUNT(*) FROM plans WHERE user_id = ? AND status = 'done'", (user_id,)).fetchone()[0] \
        + conn.execute("""SELECT COUNT(*) FROM plan_exceptions e JOIN plans p ON p.id = e.plan_id
                          WHERE p.user_id = ? AND e.status = 'done'""", (user_id,)).fetchone()[0]
    habit_done = conn.execute("SELECT habit_id, local_date FROM habit_logs WHERE user_id = ? AND done = 1 ORDER BY habit_id, local_date",
                              (user_id,)).fetchall()
    conn.close()

    modes = Counter(r["mode"] for r in done)
    spheres = Counter(r["sphere"] for r in done if r["sphere"])
    days = Counter(r["local_date"] for r in done if r["local_date"])
    dates = sorted(date.fromisoformat(d) for d in days)
    comeback = any((b - a).days >= 14 for a, b in zip(dates, dates[1:]))
    m = {
        "total": len(done),
        "streak_best": max(user.get("streak_best") or 0, user.get("streak_current") or 0),
        "spheres": len(spheres),
        "board_lines": sum(1 for r in board if r["kind"].startswith("line")),
        "board_full": sum(1 for r in board if r["kind"] == "full"),
        "pair": modes.get("pair", 0),
        "company": modes.get("company", 0),
        "social": modes.get("pair", 0) + modes.get("company", 0),
        "early": sum(1 for r in done if r["local_hour"] is not None and 4 <= r["local_hour"] < 9),
        "night": sum(1 for r in done if r["local_hour"] is not None and (r["local_hour"] >= 23 or r["local_hour"] < 4)),
        "max_day": max(days.values()) if days else 0,
        "comeback": 1 if comeback else 0,
        "daily": sum(1 for r in done if r["daily"]),
        "weekend": sum(1 for r in done if r["local_date"] and date.fromisoformat(r["local_date"]).weekday() >= 5),
        "favorites": favorites,
        "offers": offers,
        "active_now": active_now,
        "level": level_for_xp(user.get("xp") or 0),
        "active_days": len(days),
        "habits_created": habits_created,
        "habit_done": len(habit_done),
        "habit_streak": _longest_habit_run(habit_done),
        "photos": len(photo_rows),
        "photo_reports": len({r[1] for r in photo_rows if r[0] == "quest" and r[1]}),
        "photo_streak": _longest_day_run({r[2] for r in photo_rows if r[2]}),
        "photo_month": max(Counter(r[2][:7] for r in photo_rows if r[2]).values(), default=0),
        "plans_done": plans_done,
    }
    for sphere in BINGO_SPHERES:
        m[f"sphere:{sphere}"] = spheres.get(sphere, 0)
    return m


def _longest_day_run(days: set) -> int:
    best = 0
    for d in days:
        prev = (date.fromisoformat(d) - timedelta(days=1)).isoformat()
        if prev in days:
            continue  # считаем только от начала серии
        n, cur = 0, date.fromisoformat(d)
        while cur.isoformat() in days:
            n += 1
            cur += timedelta(days=1)
        best = max(best, n)
    return best


def _longest_habit_run(rows) -> int:
    """Самая длинная серия выполненных дней среди всех привычек."""
    best, run, prev_habit, prev_day = 0, 0, None, None
    for r in rows:
        day = date.fromisoformat(r["local_date"])
        if r["habit_id"] == prev_habit and prev_day and (day - prev_day).days == 1:
            run += 1
        else:
            run = 1
        prev_habit, prev_day = r["habit_id"], day
        best = max(best, run)
    return best


def _unlocked(user_id: int) -> dict:
    conn = storage.connect()
    rows = conn.execute("SELECT code, unlocked_at FROM achievements_unlocked WHERE user_id = ?", (user_id,)).fetchall()
    conn.close()
    return dict(rows)


def achievement_public(a, metrics: dict, unlocked_at: str = None) -> dict:
    code, title, how, icon, color, metric, target = a
    value = metrics.get(metric, 0)
    return {"code": code, "title": title, "how": how, "icon": icon, "color": color,
            "target": target, "value": min(value, target) if not unlocked_at else target,
            "unlocked": bool(unlocked_at), "unlocked_at": unlocked_at}


def check_achievements(user_id: int) -> list:
    """Открывает всё, чего пользователь достиг, и возвращает новые ачивки."""
    metrics = achievement_metrics(user_id)
    have = _unlocked(user_id)
    new = [a for a in ACHIEVEMENTS if a[0] not in have and metrics.get(a[5], 0) >= a[6]]
    if not new:
        return []
    now = storage.utc_now_str()
    conn = storage.connect()
    conn.executemany("INSERT OR IGNORE INTO achievements_unlocked (user_id, code, unlocked_at) VALUES (?, ?, ?)",
                     [(user_id, a[0], now) for a in new])
    conn.commit()
    conn.close()
    return [achievement_public(a, metrics, now) for a in new]


def achievements_view(user_id: int) -> list:
    metrics = achievement_metrics(user_id)
    have = _unlocked(user_id)
    return [achievement_public(a, metrics, have.get(a[0])) for a in ACHIEVEMENTS]


# ==================== КАРТА НЕДЕЛИ ====================
BOARD_LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]


def board_progress(board: dict) -> dict:
    ok = [bool(d) and bool(c.strip()) for c, d in zip(board["cells"], board["done"])]
    lines = [i for i, line in enumerate(BOARD_LINES) if all(ok[j] for j in line)]
    return {"done_cells": [i for i, v in enumerate(ok) if v], "lines": lines, "full": all(ok)}


def get_board(user_id: int) -> dict:
    user = storage.get_user(user_id)
    today = local_today(user)
    board = storage.get_weekly_board(user_id, today)
    return {"board": board, "week_range": storage.get_week_range_label(today),
            "week_key": storage.get_current_week_key(today), "progress": board_progress(board)}


def save_board(user_id: int, raw) -> dict:
    """Сохраняет карту и начисляет XP за новые клетки, линии и полную карту
    (каждая награда — один раз за неделю)."""
    user = storage.get_user(user_id)
    today = local_today(user)
    wk = storage.get_current_week_key(today)
    board = storage.normalize_board(raw)
    storage.save_weekly_board(user_id, board, today)
    prog = board_progress(board)

    wanted = [(f"cell{i}", BOARD_CELL_XP, "Клетка карты") for i in prog["done_cells"]]
    wanted += [(f"line{i}", BOARD_LINE_XP, "Линия на карте") for i in prog["lines"]]
    if prog["full"]:
        wanted.append(("full", BOARD_FULL_XP, "Полная карта"))
    conn = storage.connect()
    awarded = []
    for kind, xp, label in wanted:
        cur = conn.execute("INSERT OR IGNORE INTO board_awards (user_id, week_key, kind, xp, created_at) VALUES (?, ?, ?, ?, ?)",
                           (user_id, wk, kind, xp, storage.utc_now_str()))
        if cur.rowcount:
            awarded.append({"kind": kind, "xp": xp, "label": label})
    conn.commit()
    conn.close()

    level_before = level_for_xp(user.get("xp") or 0)
    total = sum(a["xp"] for a in awarded)
    add_xp(user_id, total, "board", today.isoformat())
    xp_total = (user.get("xp") or 0) + total
    if prog["done_cells"]:
        storage.touch_activity(user_id)
    return {
        "board": board, "progress": prog, "awarded": awarded, "xp": total,
        "new_lines": [int(a["kind"][4:]) for a in awarded if a["kind"].startswith("line")],
        "new_full": any(a["kind"] == "full" for a in awarded),
        "level_up": level_info(xp_total) if level_for_xp(xp_total) > level_before else None,
        "new_achievements": check_achievements(user_id),
    }


# ==================== СОСТОЯНИЕ И СТАТИСТИКА ====================
GREETINGS = [
    "Сегодня отличный день, чтобы выйти из привычного сценария.",
    "Одно маленькое приключение — и день уже не как все.",
    "Я тут придумала кое-что странное. Тебе понравится.",
    "Не обязательно делать всё. Достаточно сделать шаг.",
    "Скучные дни — это просто дни без квеста.",
    "Пора удивить себя?",
    "Смелость — это навык. Потренируемся?",
    "Даже 15 минут приключения считаются.",
]


def done_by_day(user_id: int, start: date, end: date) -> dict:
    conn = storage.connect()
    rows = conn.execute("""SELECT local_date, COUNT(*) FROM quest_history
                           WHERE user_id = ? AND status = 'done' AND local_date BETWEEN ? AND ?
                           GROUP BY local_date""", (user_id, start.isoformat(), end.isoformat())).fetchall()
    conn.close()
    return dict(rows)


def get_state(user_id: int) -> dict:
    user = storage.get_user(user_id)
    now = local_now(user)
    today = now.date()
    lv = level_info(user.get("xp") or 0)
    week = done_by_day(user_id, today - timedelta(days=6), today)
    month = sum(done_by_day(user_id, today.replace(day=1), today).values())
    daily_id = daily_quest_id(today)
    conn = storage.connect()
    daily_status = conn.execute("""SELECT status FROM quest_history WHERE user_id = ? AND quest_key = ? AND daily = 1
                                   AND local_date = ? ORDER BY id DESC LIMIT 1""",
                                (user_id, daily_id, today.isoformat())).fetchone()
    badges = conn.execute("SELECT COUNT(*) FROM achievements_unlocked WHERE user_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    daily = public_quest(CATALOG[daily_id])
    daily["status"] = daily_status[0] if daily_status else None
    daily["bonus_xp"] = DAILY_BONUS

    return {
        "user": {
            "id": user_id, "first_name": user.get("first_name") or user.get("username") or "",
            "mascot": LEGACY_MASCOTS.get(user.get("mascot"), user.get("mascot")) or "cat-purple",
            "theme": user.get("theme") if user.get("theme") in THEME_IDS else "classic",
            "accessory": user.get("accessory") if user.get("accessory") in ACCESSORY_IDS else None,
            "balance": balance(user),
            "daily_goal": user.get("daily_goal") or 1, "tz": user.get("tz"),
            "reminder_hour": user.get("reminder_hour") if user.get("reminder_hour") is not None else 9,
            "evening_reminder_hour": user.get("evening_reminder_hour") if user.get("evening_reminder_hour") is not None else 20,
            "is_premium": bool(user.get("is_premium")),
            "onboarded": bool(user.get("onboarded")),
        },
        "level": lv,
        "unlocks": unlocks(lv["level"]),
        "streak": streak_view(user.get("streak_current"), user.get("streak_best"),
                              user.get("streak_last_date"), user.get("freeze_week"), today,
                              user.get("freeze_tokens")),
        "today": {"date": today.isoformat(), "hour": now.hour, "done": week.get(today.isoformat(), 0),
                  "goal": user.get("daily_goal") or 1},
        "month_done": month,
        "badges": {"unlocked": badges, "total": len(ACHIEVEMENTS)},
        "week": [{"date": (today - timedelta(days=6 - i)).isoformat(),
                  "count": week.get((today - timedelta(days=6 - i)).isoformat(), 0)} for i in range(7)],
        "active": active_quests_view(user_id),
        "favorites": favorites_view(user_id),
        "daily": daily,
        "rolls_left": max(0, roll_limit(user) - rolls_today(user_id, today)),
        "greeting": GREETINGS[today.toordinal() % len(GREETINGS)],
        "spheres": BINGO_SPHERES,
    }


def get_stats(user_id: int, days) -> dict:
    user = storage.get_user(user_id)
    today = local_today(user)
    conn = storage.connect(rows=True)
    done = conn.execute("""SELECT id, quest_key, mode, sphere, title, local_date, xp, completed_at FROM quest_history
                           WHERE user_id = ? AND status = 'done' AND local_date IS NOT NULL
                           ORDER BY completed_at DESC, id DESC""", (user_id,)).fetchall()
    xp_rows = conn.execute("SELECT local_date, SUM(amount) FROM xp_log WHERE user_id = ? GROUP BY local_date",
                           (user_id,)).fetchall()
    conn.close()

    if days == "all":
        first = min((date.fromisoformat(r["local_date"]) for r in done), default=today)
        span = min(max((today - first).days + 1, 7), 366)
    else:
        span = int(days)
    start = today - timedelta(days=span - 1)
    in_range = [r for r in done if r["local_date"] >= start.isoformat()]
    per_day = Counter(r["local_date"] for r in in_range)
    xp_by_day = {d: x for d, x in xp_rows}
    series = []
    for i in range(span):
        d = (start + timedelta(days=i)).isoformat()
        series.append({"date": d, "count": per_day.get(d, 0), "xp": xp_by_day.get(d, 0) or 0})

    all_days = Counter(r["local_date"] for r in done)
    month_start = today.replace(day=1)
    next_month = (month_start + timedelta(days=32)).replace(day=1)
    heatmap = [{"date": (month_start + timedelta(days=i)).isoformat(),
                "count": all_days.get((month_start + timedelta(days=i)).isoformat(), 0)}
               for i in range((next_month - month_start).days)]

    weeks = Counter(storage.week_key_for(date.fromisoformat(r["local_date"])) for r in done)
    best_week = weeks.most_common(1)[0] if weeks else None
    spheres_all = Counter(r["sphere"] for r in done if r["sphere"])
    fav_sphere = spheres_all.most_common(1)[0][0] if spheres_all else None

    def lookup(r):
        q = CATALOG.get(r["quest_key"]) or {}
        return {"id": r["quest_key"], "hid": r["id"], "title": r["title"] or q.get("title") or "Задание",
                "emoji": q.get("emoji") or "📌", "mode": r["mode"], "sphere": r["sphere"],
                "date": r["local_date"], "xp": r["xp"] or 0}

    return {
        "range": days, "series": series,
        "total_in_range": len(in_range),
        "spheres": [{"sphere": s, "count": Counter(r["sphere"] for r in in_range).get(s, 0)} for s in BINGO_SPHERES],
        "modes": [{"mode": m, "count": Counter(r["mode"] for r in in_range).get(m, 0)} for m in MODES],
        "heatmap": heatmap,
        "records": {
            "best_streak": max(user.get("streak_best") or 0, user.get("streak_current") or 0),
            "best_week": {"week": best_week[0], "count": best_week[1]} if best_week else None,
            "favorite_sphere": fav_sphere,
            "total": len(done),
            "xp": user.get("xp") or 0,
        },
        "history": [lookup(r) for r in done[:60]],
    }


SETTINGS_ALLOWED = {"daily_goal", "tz", "mascot", "theme", "reminder_hour", "evening_reminder_hour"}


# ==================== МАГАЗИН ====================
# XP копится и тратится: уровень считается по всему заработанному XP,
# а в магазине тратится баланс = xp - xp_spent.
FREEZE_PRICE = 60
FREEZE_MAX = 3
ACCESSORIES = [  # id, название, цена
    ("flower", "Цветочек", 60),
    ("bow", "Бантик", 80),
    ("cap", "Кепка", 100),
    ("glasses", "Очки", 100),
    ("party", "Колпак", 120),
    ("headphones", "Наушники", 140),
    ("crown", "Корона", 200),
    ("halo", "Нимб", 250),
]
ACCESSORY_IDS = {a[0] for a in ACCESSORIES}


def balance(user: dict) -> int:
    return max(0, (user.get("xp") or 0) - (user.get("xp_spent") or 0))


def owned_items(user_id: int) -> set:
    conn = storage.connect()
    rows = conn.execute("SELECT DISTINCT item FROM purchases WHERE user_id = ?", (user_id,)).fetchall()
    conn.close()
    return {r[0] for r in rows}


def shop_view(user_id: int) -> dict:
    user = storage.get_user(user_id)
    owned = owned_items(user_id)
    tokens = user.get("freeze_tokens") or 0
    items = [{"id": "freeze", "kind": "freeze", "name": "Заморозка серии", "price": FREEZE_PRICE,
              "count": tokens, "max": FREEZE_MAX,
              "about": "Спасает серию за пропущенный день. Действует сама, хранится до 3 штук."}]
    for aid, name, price in ACCESSORIES:
        items.append({"id": aid, "kind": "accessory", "name": name, "price": price,
                      "owned": aid in owned, "equipped": user.get("accessory") == aid})
    return {"balance": balance(user), "xp": user.get("xp") or 0, "freeze_tokens": tokens,
            "accessory": user.get("accessory"), "items": items}


def buy(user_id: int, item: str) -> dict:
    """Покупка списывает баланс одним UPDATE с проверкой — без гонок при двойном нажатии."""
    user = storage.get_user(user_id)
    if item == "freeze":
        price = FREEZE_PRICE
        if (user.get("freeze_tokens") or 0) >= FREEZE_MAX:
            raise QuestError(f"Больше {FREEZE_MAX} заморозок не помещается в морозилку 🧊")
        extra = ", freeze_tokens = COALESCE(freeze_tokens, 0) + 1"
        cond = f" AND COALESCE(freeze_tokens, 0) < {FREEZE_MAX}"
    elif item in ACCESSORY_IDS:
        price = next(p for a, _n, p in ACCESSORIES if a == item)
        if item in owned_items(user_id):
            raise QuestError("Это уже твоё 🙂")
        extra, cond = ", accessory = ?", ""
    else:
        raise QuestError("Такого товара нет")
    conn = storage.connect()
    params = [price] + ([item] if item in ACCESSORY_IDS else []) + [user_id, price]
    cur = conn.execute(f"""UPDATE users SET xp_spent = COALESCE(xp_spent, 0) + ?{extra}
                           WHERE user_id = ? AND COALESCE(xp, 0) - COALESCE(xp_spent, 0) >= ?{cond}""", params)
    if cur.rowcount != 1:
        conn.close()
        raise QuestError(f"Не хватает XP: нужно {price}, есть {balance(user)}")
    conn.execute("INSERT INTO purchases (user_id, item, price, created_at) VALUES (?, ?, ?, ?)",
                 (user_id, item, price, storage.utc_now_str()))
    conn.commit()
    conn.close()
    return shop_view(user_id)


def equip(user_id: int, item) -> dict:
    if item is not None and item not in owned_items(user_id):
        raise QuestError("Сначала купи этот аксессуар")
    storage.update_user(user_id, accessory=item)
    return shop_view(user_id)


def update_settings(user_id: int, data: dict) -> dict:
    """Проверяет каждое поле отдельно; неизвестные поля молча игнорирует."""
    user = storage.get_user(user_id)
    level = level_for_xp(user.get("xp") or 0)
    fields = {}
    if "daily_goal" in data:
        try:
            fields["daily_goal"] = max(1, min(3, int(data["daily_goal"])))
        except (TypeError, ValueError):
            raise QuestError("Цель дня — от 1 до 3")
    for key in ("reminder_hour", "evening_reminder_hour"):
        if key in data:
            try:
                hour = int(data[key])
            except (TypeError, ValueError):
                raise QuestError("Час — число от 0 до 23")
            if not 0 <= hour <= 23:
                raise QuestError("Час — число от 0 до 23")
            fields[key] = hour
    if "tz" in data:
        if not valid_tz(data["tz"]):
            raise QuestError("Не знаю такой часовой пояс")
        fields["tz"] = data["tz"]
    if "mascot" in data:
        allowed = {k for k, _n, lv in MASCOTS if level >= lv}
        if data["mascot"] not in allowed:
            raise QuestError("Этот маскот откроется на более высоком уровне")
        fields["mascot"] = data["mascot"]
    if "theme" in data:
        if data["theme"] not in THEME_IDS:
            raise QuestError("Такого стиля нет")
        fields["theme"] = data["theme"]
    if "onboarded" in data:
        fields["onboarded"] = 1 if data["onboarded"] else 0
    if "morning_plans" in data:
        fields["morning_plans"] = 1 if data["morning_plans"] else 0
    storage.update_user(user_id, **fields)
    return fields

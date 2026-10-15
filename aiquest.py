"""Квест под настроение: человек выбирает настроение, время и место —
ИИ (Groq, ключ в GROQ_API_KEY) придумывает уникальное задание. Без ключа
или при ошибке сети — подбираем подходящее задание из каталога.

Сгенерированные задания хранятся в ai_quests и принимаются как обычные
квесты с id вида "ai_<номер>"."""

import json
import os

import aiohttp

import game
import mood_bank
import storage
from quests_database import BINGO_SPHERES

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
DAILY_LIMIT = 3
DAILY_LIMIT_PREMIUM = 30

MOODS = {
    "bored": ("😴 Скучно", ["Приключения", "Творчество", "Смелость"]),
    "tired": ("🫠 Нет сил", ["Энергия", "Дисциплина"]),
    "brave": ("🦁 Хочу встряску", ["Смелость", "Приключения"]),
    "cozy": ("🧸 Хочу уюта", ["Творчество", "Энергия"]),
    "smart": ("🧠 Хочу умнеть", ["Саморазвитие", "Дисциплина"]),
}
TIMES = {"15": "15 минут", "60": "около часа", "day": "целый день"}
PLACES = {"home": "дома", "city": "в городе"}
PLACE_RULE = {"home": "не выходя из дома", "city": "на улице, в городе — не дома"}


def api_key() -> str:
    return os.getenv("GROQ_API_KEY", "").strip()


def options() -> dict:
    return {"moods": [{"id": k, "label": v[0]} for k, v in MOODS.items()],
            "times": [{"id": k, "label": v} for k, v in TIMES.items()],
            "places": [{"id": k, "label": v} for k, v in PLACES.items()],
            "ai": bool(api_key())}


def _today_count(user_id: int, today: str) -> int:
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM ai_quests WHERE user_id = ? AND local_date = ? AND COALESCE(ai, 1) = 1",
                     (user_id, today)).fetchone()[0]
    conn.close()
    return n


def limit_for(user: dict) -> int:
    return DAILY_LIMIT_PREMIUM if game.is_premium(user) else DAILY_LIMIT


def get(quest_id: str, user_id: int = None):
    """Сгенерированное задание в формате каталога (или None)."""
    if not str(quest_id).startswith("ai_") or not quest_id[3:].isdigit():
        return None
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM ai_quests WHERE id = ?", (int(quest_id[3:]),)).fetchone()
    conn.close()
    if not row or (user_id is not None and row["user_id"] != user_id):
        return None
    return {"id": quest_id, "mode": "solo", "sphere": row["sphere"], "emoji": row["emoji"] or "✨",
            "title": row["title"], "text": row["text"], "tiers": {"medium": row["text"]},
            "why": None, "outcome": None, "ai": True}


def _prompt(mood: str, time: str, place: str, done_titles: list) -> list:
    avoid = "; ".join(done_titles[:15]) or "—"
    system = (
        "Ты — LifeQuest, игра, которая подкидывает необычные задания на день. Придумай ОДНО задание на русском. "
        "Оно должно быть конкретным, выполнимым, безопасным, законным и бесплатным или почти бесплатным, "
        "с щепоткой юмора и приключения — не банальным («сходи в кино», «почитай книгу» — нельзя). "
        "Пиши на «ты», в гендерно-нейтральной форме (без «сделал(а)», без глаголов прошедшего времени о человеке). "
        "Ответь строго JSON: {\"emoji\": один эмодзи, \"title\": название до 40 символов, "
        "\"text\": 2–3 предложения, что сделать, \"sphere\": одна из " + ", ".join(BINGO_SPHERES) + "}."
    )
    user = (f"Настроение: {MOODS[mood][0]}. Времени: {TIMES[time]}. Где: {PLACES[place]} — задание выполняется "
            f"строго {PLACE_RULE[place]}. "
            f"Не повторяй эти задания: {avoid}.")
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def _ask_groq(messages: list) -> dict:
    headers = {"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"}
    body = {"model": GROQ_MODEL, "messages": messages, "temperature": 1.0, "max_tokens": 400,
            "response_format": {"type": "json_object"}}
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.post(GROQ_URL, headers=headers, json=body) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Groq {resp.status}: {(await resp.text())[:200]}")
            data = await resp.json()
    raw = json.loads(data["choices"][0]["message"]["content"])
    title = str(raw.get("title") or "").strip()[:60]
    text = str(raw.get("text") or "").strip()[:600]
    if not title or len(text) < 20:
        raise ValueError("пустой ответ модели")
    sphere = raw.get("sphere") if raw.get("sphere") in BINGO_SPHERES else None
    emoji = str(raw.get("emoji") or "✨").strip()[:4] or "✨"
    return {"emoji": emoji, "title": title, "text": text, "sphere": sphere}


def _save(user_id: int, q: dict, today: str, ai: bool) -> dict:
    conn = storage.connect()
    cur = conn.execute("""INSERT INTO ai_quests (user_id, emoji, title, text, sphere, local_date, created_at, ai)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                       (user_id, q["emoji"], q["title"], q["text"], q["sphere"], today, storage.utc_now_str(), 1 if ai else 0))
    conn.commit()
    conn.close()
    quest = game.public_quest(get(f"ai_{cur.lastrowid}"))
    quest["ai"] = ai
    return quest


def _fallback(user_id: int, mood: str, time: str, place: str, today: str) -> dict:
    """Задание из банка mood_bank — точно под настроение, место и время."""
    emoji, title, text, sphere = mood_bank.BANK[(mood, place)][time]
    return _save(user_id, {"emoji": emoji, "title": title, "text": text, "sphere": sphere}, today, ai=False)


async def generate(user_id: int, mood: str, time: str, place: str) -> dict:
    if mood not in MOODS or time not in TIMES or place not in PLACES:
        raise game.QuestError("Выбери настроение, время и место")
    user = storage.get_user(user_id)
    today = game.local_today(user).isoformat()
    if not api_key():
        return {"quest": _fallback(user_id, mood, time, place, today), "ai": False}
    if _today_count(user_id, today) >= limit_for(user):
        raise game.QuestError("ИИ-квесты на сегодня закончились — завтра будут новые ✨", code="ai_limit")
    conn = storage.connect()
    done_titles = [r[0] for r in conn.execute(
        "SELECT title FROM quest_history WHERE user_id = ? AND title IS NOT NULL ORDER BY id DESC LIMIT 15",
        (user_id,)).fetchall()]
    conn.close()
    try:
        q = await _ask_groq(_prompt(mood, time, place, done_titles))
    except Exception as e:  # сеть, лимиты Groq, кривой JSON — не страшно, есть каталог
        print(f"AI quest fallback: {e}")
        return {"quest": _fallback(user_id, mood, time, place, today), "ai": False}
    quest = _save(user_id, q, today, ai=True)
    return {"quest": quest, "ai": True, "left": max(0, limit_for(user) - _today_count(user_id, today))}

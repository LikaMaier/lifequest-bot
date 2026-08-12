# ============================================================
# LIFQUEST BOT — Telegram Bot Template (aiogram 3.x)
# Версия с Groq API (бесплатный tier, без VPN)
# ============================================================

import asyncio
import json
import os
import random
import re
import sqlite3
from datetime import datetime, timedelta

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, 
    InlineKeyboardButton, ReplyKeyboardRemove,
    BotCommand
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

# Для Groq API (совместим с OpenAI SDK)
from groq import AsyncGroq

load_dotenv()

# ==================== CONFIG ====================
BOT_TOKEN = os.getenv("BOT_TOKEN")  # @BotFather
GROQ_API_KEY = os.getenv("GROQ_API_KEY")  # console.groq.com
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# Groq клиент (совместим с OpenAI API)
client = AsyncGroq(api_key=GROQ_API_KEY)

scheduler = AsyncIOScheduler()

# ==================== DATABASE ====================
DB_PATH = "lifequest.db"

def _ensure_column(c, table: str, column: str, coltype: str):
    c.execute(f"PRAGMA table_info({table})")
    cols = [row[1] for row in c.fetchall()]
    if column not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            profile TEXT,
            bingo_card TEXT,
            current_week INTEGER DEFAULT 1,
            streak_days INTEGER DEFAULT 0
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS survey_answers (
            user_id INTEGER,
            question_id TEXT,
            answer_value INTEGER,
            answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS completed_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            task_cell TEXT,
            task_text TEXT,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migrations for bots created before these features existed.
    _ensure_column(c, "users", "last_active_date", "TEXT")
    _ensure_column(c, "users", "reminder_hour", "INTEGER DEFAULT 9")
    _ensure_column(c, "users", "scores", "TEXT")
    _ensure_column(c, "users", "card_regens", "INTEGER DEFAULT 0")
    _ensure_column(c, "users", "evening_reminder_hour", "INTEGER DEFAULT 20")
    _ensure_column(c, "completed_tasks", "week", "INTEGER DEFAULT 1")

    conn.commit()
    conn.close()

init_db()

def ensure_user(user_id: int, username: str = None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)", (user_id, username))
    conn.commit()
    conn.close()

def save_answer(user_id: int, q_id: str, value: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO survey_answers (user_id, question_id, answer_value) VALUES (?, ?, ?)",
              (user_id, q_id, value))
    conn.commit()
    conn.close()

def get_all_answers(user_id: int) -> dict:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT question_id, answer_value FROM survey_answers WHERE user_id = ?", (user_id,))
    rows = c.fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}

def save_user_profile(user_id: int, profile: str, scores_json: str, bingo_json: str):
    """Upsert so a re-taken survey never wipes week/streak/username — only
    profile, scores and bingo_card are touched."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO users (user_id, profile, scores, bingo_card)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            profile = excluded.profile,
            scores = excluded.scores,
            bingo_card = excluded.bingo_card
    """, (user_id, profile, scores_json, bingo_json))
    conn.commit()
    conn.close()

def get_user_profile(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT profile, bingo_card FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row if row else (None, None)

def get_user_scores(user_id: int) -> dict:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT scores FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    if row and row[0]:
        try:
            return json.loads(row[0])
        except (TypeError, json.JSONDecodeError):
            pass
    return {}

def save_bingo_card(user_id: int, card: dict):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET bingo_card = ? WHERE user_id = ?",
              (json.dumps(card, ensure_ascii=False), user_id))
    conn.commit()
    conn.close()

def get_bingo_card(user_id: int) -> dict:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT bingo_card FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    if row and row[0]:
        try:
            return json.loads(row[0])
        except (TypeError, json.JSONDecodeError):
            pass
    return {}

def get_user_week(user_id: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT current_week FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else 1

def advance_week(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET current_week = COALESCE(current_week, 1) + 1, card_regens = 0 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

def get_card_regens(user_id: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT card_regens FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else 0

def increment_card_regens(user_id: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET card_regens = COALESCE(card_regens, 0) + 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    c.execute("SELECT card_regens FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else 0

def touch_activity(user_id: int):
    """Updates the daily streak: +1 if last active yesterday, reset to 1 on a gap,
    unchanged if already counted today."""
    today = datetime.now().date()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT last_active_date, streak_days FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    if row:
        last_active, streak = row
        streak = streak or 0
        if last_active == str(today):
            pass
        elif last_active == str(today - timedelta(days=1)):
            c.execute("UPDATE users SET last_active_date = ?, streak_days = ? WHERE user_id = ?",
                      (str(today), streak + 1, user_id))
        else:
            c.execute("UPDATE users SET last_active_date = ?, streak_days = 1 WHERE user_id = ?",
                      (str(today), user_id))
        conn.commit()
    conn.close()

def get_streak(user_id: int) -> int:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT streak_days FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else 0

def save_completed_task(user_id: int, cell: str, text: str, week: int = None):
    if week is None:
        week = get_user_week(user_id)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO completed_tasks (user_id, task_cell, task_text, week)
        VALUES (?, ?, ?, ?)
    """, (user_id, cell, text, week))
    conn.commit()
    conn.close()

def get_completed_cells(user_id: int, week: int = None) -> list:
    if week is None:
        week = get_user_week(user_id)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT DISTINCT task_cell FROM completed_tasks WHERE user_id = ? AND week = ?", (user_id, week))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows]

def get_recent_completed_texts(user_id: int, limit: int = 8) -> list:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT task_text FROM completed_tasks
        WHERE user_id = ? AND task_text IS NOT NULL
        ORDER BY completed_at DESC LIMIT ?
    """, (user_id, limit))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows if r[0]]

def get_completed_today(user_id: int) -> list:
    """Клетки, отмеченные сегодня (по дате сервера) — для вечернего напоминания."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT task_cell FROM completed_tasks
        WHERE user_id = ? AND date(completed_at) = date('now')
        ORDER BY completed_at
    """, (user_id,))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows]

# ==================== SURVEY DATA ====================
SURVEY_QUESTIONS = [
    {"id": "q1", "sphere": "📋 Дисциплина", "question": "Когда у тебя свободное время без чётких планов — что чаще происходит?",
     "options": [("Быстро нахожу дело", 1), ("Залипаю в телефон", 2),
                 ("Жду, что предложат", 3), ("Делаю привычное", 4)]},
    {"id": "q2", "sphere": "📋 Дисциплина", "question": "Что бывает, когда день прошёл не так, как хотелось?",
     "options": [("Разбираю, что не так", 1), ("Расстраиваюсь и повторяю", 2),
                 ("Наверстываю вечером", 3), ("Быстро забываю", 4)]},
    {"id": "q3", "sphere": "📋 Дисциплина", "question": "Дело откладывается обычно потому что...",
     "options": [("Не знаю, с чего начать", 1), ("Кажется слишком большим", 2),
                 ("Боюсь сделать плохо", 3), ("Просто неинтересно", 4)]},
    {"id": "q4", "sphere": "⚡ Энергия", "question": "Когда в последний раз что-то увлекло тебя само, без усилий?",
     "options": [("Недавно, помню что", 1), ("Давно, еле вспомню", 2),
                 ("Не помню такого", 3), ("Постоянно увлекает", 4)]},
    {"id": "q5", "sphere": "⚡ Энергия", "question": "После чего ты обычно чувствуешь прилив, а не опустошение?",
     "options": [("После движения", 1), ("После новых идей", 2),
                 ("После тишины и покоя", 3), ("Редко чувствую прилив", 4)]},
    {"id": "q6", "sphere": "⚡ Энергия", "question": "Вечерний скролл в телефоне — это чаще...",
     "options": [("Отдых, который выбираю", 1), ("Способ не думать о дне", 2),
                 ("Привычка, о ней жалею", 3), ("Почти нет скролла", 4)]},
    {"id": "q7", "sphere": "🧠 Саморазвитие", "question": "Когда варианты, чем заняться, есть — что мешает выбрать?",
     "options": [("Ни один не цепляет", 1), ("Слишком много вариантов", 2),
                 ("Боюсь ошибиться в выборе", 3), ("Обычно выбираю легко", 4)]},
    {"id": "q8", "sphere": "🧠 Саморазвитие", "question": "Твоя главная сложность в развитии сейчас — это...",
     "options": [("Не понимаю, чего хочу", 1), ("Знаю, но не делаю", 2),
                 ("Делаю, но бросаю", 3), ("Делаю, но медленно", 4)]},
    {"id": "q9", "sphere": "💪 Смелость", "question": "Что чаще держит тебя на месте?",
     "options": [("Страх ошибиться", 1), ("Страх чужого мнения", 2),
                 ("Не вижу смысла в риске", 3), ("Не знаю, с чего начать", 4)]},
    {"id": "q10", "sphere": "💪 Смелость", "question": "Когда последний раз ты вышла из зоны комфорта не по необходимости, а по своей воле?",
     "options": [("Недавно", 1), ("Было давно", 2),
                 ("Почти никогда", 3), ("Делаю это регулярно", 4)]},
    {"id": "q11", "sphere": "🌍 Приключения", "question": "Что тебе сейчас нужнее?",
     "options": [("Новые впечатления", 1), ("Новые люди рядом", 2),
                 ("Новые задачи", 3), ("Просто пауза", 4)]},
    {"id": "q12", "sphere": "🌍 Приключения", "question": "Скука в привычной жизни — это про...",
     "options": [("Предсказуемый быт", 1), ("Нет целей впереди", 2),
                 ("Мало сил на перемены", 3), ("Скуки нет", 4)]},
    {"id": "q13", "sphere": "🎨 Творчество", "question": "Когда ты в последний раз делала что-то просто ради процесса, не ради результата?",
     "options": [("Недавно", 1), ("Давно", 2),
                 ("Не помню такого", 3), ("Делаю регулярно", 4)]},
    {"id": "q14", "sphere": "🎨 Творчество", "question": "Что мешает выражать себя чаще?",
     "options": [("Нет времени", 1), ("Боюсь показать другим", 2),
                 ("Не знаю, в чём", 3), ("Ничего не мешает", 4)]},
    {"id": "q15", "sphere": "🎨 Творчество", "question": "Идеальный способ «выпустить» то, что внутри — это...",
     "options": [("Через слова", 1), ("Через тело", 2),
                 ("Через визуал", 3), ("Через звук", 4)]},
]

SURVEY_QUESTIONS_BY_ID = {q["id"]: q for q in SURVEY_QUESTIONS}

# ==================== FSM STATES ====================
class SurveyStates(StatesGroup):
    q1 = State(); q2 = State(); q3 = State(); q4 = State(); q5 = State()
    q6 = State(); q7 = State(); q8 = State(); q9 = State(); q10 = State()
    q11 = State(); q12 = State(); q13 = State(); q14 = State(); q15 = State()
    analyzing = State()

STATE_MAP = {
    SurveyStates.q1: 0, SurveyStates.q2: 1, SurveyStates.q3: 2,
    SurveyStates.q4: 3, SurveyStates.q5: 4, SurveyStates.q6: 5,
    SurveyStates.q7: 6, SurveyStates.q8: 7, SurveyStates.q9: 8,
    SurveyStates.q10: 9, SurveyStates.q11: 10, SurveyStates.q12: 11,
    SurveyStates.q13: 12, SurveyStates.q14: 13, SurveyStates.q15: 14,
}

# ==================== KEYBOARD BUILDER ====================
def build_question_keyboard(q_id: str, options: list, show_back: bool = False) -> InlineKeyboardMarkup:
    buttons = []
    for text, value in options:
        buttons.append([InlineKeyboardButton(text=text, callback_data=f"{q_id}_{value}")])
    if show_back:
        buttons.append([InlineKeyboardButton(text="« Назад", callback_data=f"back_{q_id}")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)

def state_for_index(idx: int):
    return list(STATE_MAP.keys())[list(STATE_MAP.values()).index(idx)]

# (emoji_label, plain_label_for_image, callback_data_key)
def build_bingo_keyboard(card_keys: list, completed: list) -> InlineKeyboardMarkup:
    buttons = []
    row = []
    for i, key in enumerate(card_keys):
        label = KEY_TO_LABEL.get(key, key)
        prefix = "✅ " if key in completed else ""
        row.append(InlineKeyboardButton(text=f"{prefix}{label}", callback_data=f"bingo_cell_{key}"))
        if (i + 1) % 3 == 0:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    if not completed:
        buttons.append([InlineKeyboardButton(text="🔄 Сгенерировать новую карту", callback_data="regen_card")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)

# ==================== WELCOME ====================
WELCOME_TEXT = """🗺️ <b>Добро пожаловать в LifeQuest!</b>

Моя миссия — помочь тебе превратить свою жизнь в удивительное приключение.

Каждую неделю ты получаешь персональную бинго-карту — 9 квестов, подобранных именно под тебя: под твои сильные стороны, твои сферы жизни и то, что откликается лично тебе. Выполняй их не в чате, а по-настоящему: пробуй новое, встречайся со своими страхами, открывай в себе то, что раньше было незаметно.

<b>Как это работает:</b>
🎯 15 вопросов — чтобы я лучше тебя узнал(а)
🎲 Персональная бинго-карта — 9 квестов на неделю, под тебя
🔥 Стрик — отмечай прогресс и заряжайся с каждой неделей

<i>Это про то, чтобы снова почувствовать вкус к жизни — маленькими смелыми шагами, каждую неделю.</i>"""

@dp.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    user_id = message.from_user.id
    ensure_user(user_id, message.from_user.username)

    profile, _bingo = get_user_profile(user_id)
    if profile:
        week = get_user_week(user_id)
        streak = get_streak(user_id)
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎲 Показать мою карту", callback_data="back_to_bingo")],
            [InlineKeyboardButton(text="🔄 Пройти опрос заново", callback_data="start_survey")]
        ])
        streak_line = f"\n🔥 Стрик: {streak} дней" if streak else ""
        await message.answer(
            f"С возвращением! Ты на неделе {week}.{streak_line}\n\nУ тебя уже есть профиль и бинго-карта.",
            reply_markup=kb
        )
        return

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🚀 Начать (15 вопросов)", callback_data="start_survey")]
    ])
    await message.answer(WELCOME_TEXT, parse_mode="HTML", reply_markup=kb)

# ==================== SURVEY HANDLERS ====================
@dp.callback_query(F.data == "start_survey")
async def start_survey(callback: CallbackQuery, state: FSMContext):
    await state.set_state(SurveyStates.q1)
    q = SURVEY_QUESTIONS[0]
    await callback.message.edit_text(
        f"🧭 <b>Диагностика: где ты сейчас?</b>\n\n"
        "<b>" + q["sphere"] + "</b>\n\n"
        f"{q['question']}",
        parse_mode="HTML",
        reply_markup=build_question_keyboard(q["id"], q["options"])
    )

@dp.callback_query(F.data.startswith("back_q"))
async def handle_survey_back(callback: CallbackQuery, state: FSMContext):
    q_id = callback.data.replace("back_", "")
    idx = int(q_id[1:]) - 1
    prev_idx = idx - 1
    if prev_idx < 0:
        await callback.answer()
        return

    prev_q = SURVEY_QUESTIONS[prev_idx]
    await state.set_state(state_for_index(prev_idx))

    progress = f"\n\n<i>Вопрос {prev_idx + 1} из {len(SURVEY_QUESTIONS)}</i>" if prev_idx > 0 else ""
    await callback.message.edit_text(
        f"🧭 <b>Диагностика: где ты сейчас?</b>{progress}\n\n"
        "<b>" + prev_q["sphere"] + "</b>\n\n"
        f"{prev_q['question']}",
        parse_mode="HTML",
        reply_markup=build_question_keyboard(prev_q["id"], prev_q["options"], show_back=(prev_idx > 0))
    )
    await callback.answer()

@dp.callback_query(F.data.startswith("q"))
async def handle_survey_answer(callback: CallbackQuery, state: FSMContext):
    data = callback.data
    parts = data.split("_")
    q_id = parts[0]
    value = int(parts[1])
    user_id = callback.from_user.id

    save_answer(user_id, q_id, value)

    current_state = await state.get_state()
    current_idx = STATE_MAP.get(current_state)

    if current_idx is None:
        await callback.answer("Ошибка состояния. Начни сначала /start")
        return

    next_idx = current_idx + 1

    if next_idx >= len(SURVEY_QUESTIONS):
        await state.set_state(SurveyStates.analyzing)
        await callback.message.edit_text(
            "🧠 <b>Анализирую твои ответы...</b>\n\n"
            "Создаю персональный профиль и бинго-карту. Это займёт несколько секунд.",
            parse_mode="HTML"
        )
        await generate_and_send_profile(callback.message, user_id)
        await state.clear()
    else:
        next_q = SURVEY_QUESTIONS[next_idx]
        await state.set_state(state_for_index(next_idx))

        progress = f"\n\n<i>Вопрос {next_idx + 1} из {len(SURVEY_QUESTIONS)}</i>"
        await callback.message.edit_text(
            f"🧭 <b>Диагностика: где ты сейчас?</b>{progress}\n\n"
            "<b>" + next_q["sphere"] + "</b>\n\n"
            f"{next_q['question']}",
            parse_mode="HTML",
            reply_markup=build_question_keyboard(next_q["id"], next_q["options"], show_back=True)
        )

    await callback.answer()

# ==================== GROQ GENERATION ====================
BINGO_SPHERES = ["Дисциплина", "Энергия", "Саморазвитие", "Смелость", "Приключения", "Творчество"]
SPHERE_EMOJI = {
    "Дисциплина": "📋",
    "Энергия": "⚡",
    "Саморазвитие": "🧠",
    "Смелость": "💪",
    "Приключения": "🌍",
    "Творчество": "🎨",
}

# Задания на каждую сферу, у каждого — 2 уровня сложности ("easy"/"medium"),
# выбираются по баллу сферы из профиля (см. build_personal_bingo).
BINGO_BANK = {
    "Дисциплина": [
        {"key": "frog", "label": "🐸 Лягушка",
         "why": "Задачи, которые долго висят, забирают фоновое внимание даже когда ты о них не думаешь — мозг держит их «в очереди» и тратит на это энергию. Закрыв её, ты не просто вычёркиваешь пункт — освобождаешь ресурс, который уходил на тревогу.",
         "easy": """🐸 <b>Лягушка</b>
Выбери одно небольшое дело, которое откладываешь больше недели, и закрой его — неважно, насколько оно маленькое.""",
         "medium": """🐸 <b>Лягушка</b>
Закрой самое тяжёлое висящее дело, которое тревожит больше недели. Сделай это первым делом в один из дней. Не откладывай."""},
        {"key": "order", "label": "🧹 Порядок",
         "why": "Хаос вокруг считывается мозгом как сигнал незавершённости и подпитывает ощущение, что всё вообще не под контролем. Порядок в одной зоне — конкретное, видимое доказательство обратного, и оно работает быстрее, чем любые уговоры.",
         "easy": """🧹 <b>Порядок</b>
Приведи в порядок один маленький уголок — стол, полку, один список дел. 10 минут, не больше.""",
         "medium": """🧹 <b>Порядок</b>
Наведи порядок в одной зоне (рабочий стол, документы, часть квартиры) и составь список из 3 дел на завтра."""},
        {"key": "morning_plan", "label": "🌄 Утренний план",
         "why": "Когда решение «что делать» принято заранее, утром не остаётся зазора для сомнений — а именно в этом зазоре обычно и прячется прокрастинация. План снимает нагрузку с силы воли, перекладывая её на структуру.",
         "easy": """🌄 <b>Утренний план</b>
Реши всего одну вещь, которую сделаешь первым делом завтра утром. Одну — не расписание. И сделай её.""",
         "medium": """🌄 <b>Утренний план</b>
Распиши по часам своё завтрашнее утро — во сколько встаёшь, что делаешь первым, вторым. Выполни план завтра до обеда."""},
        {"key": "broken_promise", "label": "🔁 Обещание",
         "why": "Каждое несдержанное обещание себе понемногу подтачивает доверие к собственным словам — и решения потом даются труднее, потому что часть тебя уже не верит, что это будет сделано. Выполнив хотя бы одно, ты возвращаешь себе кредит доверия.",
         "easy": """🔁 <b>Обещание</b>
Вспомни одно маленькое обещание себе, которое давно не сдержал(а). Сделай хотя бы малую его часть сегодня.""",
         "medium": """🔁 <b>Обещание</b>
Вспомни обещание, которое дал(а) себе и не сдержал(а). Выполни его сегодня — даже если поздно, даже если неидеально."""},
        {"key": "unfinished", "label": "🧩 Дело до конца",
         "why": "Незавершённые дела занимают память сильнее, чем завершённые — мозг хуже отпускает то, что не доведено до конца. Закрыть — не значит сделать идеально, значит перестать носить это с собой.",
         "easy": """🧩 <b>Дело до конца</b>
Найди любое маленькое незаконченное дело — на 10-15 минут работы. Доделай именно его.""",
         "medium": """🧩 <b>Дело до конца</b>
Выбери дело, которое начал(а), но бросил(а) на середине. Доведи его до конца — не идеально, а просто до конца."""},
        {"key": "first_step", "label": "🚫 Первый шаг",
         "why": "У привычки обычно есть триггер и понятная выгода в моменте, поэтому просто «взять и перестать» почти никогда не работает. Один осознанный шаг меняет автоматизм на выбор — а это уже другая точка входа.",
         "easy": """🚫 <b>Первый шаг</b>
Назови вслух или запиши одну привычку, от которой хотел(а) бы избавиться, и почему. Не действуй — только осознай.""",
         "medium": """🚫 <b>Первый шаг</b>
Выбери одну вредную привычку. Сегодня сделай один конкретный шаг, который её ослабляет — убери триггер или один раз замени её другим действием."""},
        {"key": "gadget_free", "label": "📵 Без гаджетов",
         "why": "Постоянные уведомления держат нервную систему в лёгком, но непрерывном режиме готовности реагировать — и это устаёт, даже если незаметно. Пауза без гаджетов — не про силу воли, а про то, чтобы дать вниманию наконец не делиться ни с кем.",
         "easy": """📵 <b>Без гаджетов</b>
Проведи 2 часа без телефона и соцсетей сегодня — выбери любой удобный отрезок дня.""",
         "medium": """📵 <b>Без гаджетов</b>
Проведи полдня без гаджетов — без телефона, соцсетей, ленты. Только необходимая связь, если это правда нужно."""},
        {"key": "early_bed", "label": "🌙 Ранний отбой",
         "why": "Недосып снижает именно те ресурсы, которые нужны для дисциплины — способность тормозить импульсы и держать фокус. Раньше лечь — это не забота о будущем себе, это буквально пополнение того, чем ты и принимаешь решения.",
         "easy": """🌙 <b>Ранний отбой</b>
Сегодня начни готовиться ко сну на 20-30 минут раньше обычного — не про час раньше лечь, просто про раньше начать.""",
         "medium": """🌙 <b>Ранний отбой</b>
Ляг спать на час раньше обычного — подготовься заранее, чтобы это было реально."""},
        {"key": "no_list", "label": "🚫 Список «не буду»",
         "why": "Список того, что НЕ будешь делать, работает иначе, чем список задач — он заранее убирает решение из момента, когда воля слабее всего. Ты не борешься с соблазном в моменте, ты уже решил заранее, пока был спокоен.",
         "easy": """🚫 <b>Список «не буду»</b>
Выпиши 1 вещь, которую сегодня точно не будешь делать (главный триггер прокрастинации), и сдержи слово.""",
         "medium": """🚫 <b>Список «не буду»</b>
Выпиши 3 вещи, которые сегодня точно не будешь делать (главные триггеры прокрастинации), и сдержи слово."""},
        {"key": "digital_minimalism", "label": "🔋 Цифровой минимализм",
         "why": "Каждое уведомление — маленький крючок, который перезапускает цикл дофаминового ожидания, даже если ты просто взглянул и не открыл. Убрав один источник, ты не просто «меньше отвлекаешься» — ты разрываешь конкретный цикл.",
         "easy": """🔋 <b>Цифровой минимализм</b>
Отключи уведомления от одного приложения, которое отвлекает больше всего — на сегодня.""",
         "medium": """🔋 <b>Цифровой минимализм</b>
Удали или скрой одно приложение/уведомление, которое отвлекает тебя больше всего."""},
        {"key": "spending_review", "label": "🧾 Разбор трат",
         "why": "Траты, которые не осознаются, создают фоновую тревогу без понятной причины — деньги как будто утекают, а куда, непонятно. Просто увидеть картину целиком снижает тревожность даже раньше, чем ты что-то изменишь.",
         "easy": """🧾 <b>Разбор трат</b>
Просмотри траты за последние 2-3 дня — просто посмотри, не обязательно категоризировать всё.""",
         "medium": """🧾 <b>Разбор трат</b>
Просмотри и категоризируй свои траты за последнюю неделю — куда реально уходят деньги."""},
        {"key": "quiet_hour", "label": "🔕 Тихий час",
         "why": "Постоянный фоновый шум и стимуляция не дают нервной системе переключиться в режим восстановления — мозг всё время немного «слушает». Тишина — не скука, это состояние, в котором получается по-настоящему обработать день.",
         "easy": """🔕 <b>Тихий час</b>
Проведи 20-30 минут в тишине — без музыки и фонового шума.""",
         "medium": """🔕 <b>Тихий час</b>
Проведи час в полной тишине — без музыки, подкастов, фонового шума."""},
        {"key": "self_care", "label": "🧴 Уход за собой",
         "why": "Уход за собой, который откладывается «на потом», незаметно транслирует себе сообщение «я не в приоритете». Один простой ритуал меняет это сообщение на практике, а не на словах.",
         "easy": """🧴 <b>Уход за собой</b>
Удели 5-10 минут одному простому шагу ухода за собой, который обычно пропускаешь.""",
         "medium": """🧴 <b>Уход за собой</b>
Проведи полноценный ритуал ухода за собой — кожа, тело — которым обычно пренебрегаешь."""},
        {"key": "evening_tidy", "label": "🧹 5 минут вечером",
         "why": "Пространство, в котором просыпаешься, задаёт тон первым минутам дня ещё до того, как ты успеваешь о чём-то подумать. Пять минут вечером — способ подарить себе спокойное утро, а не просто убраться.",
         "easy": """🧹 <b>5 минут вечером</b>
Убери за собой сразу после того, как закончил(а) дело сегодня — не откладывай на потом.""",
         "medium": """🧹 <b>5 минут вечером</b>
Потрать 5 минут перед сном на уборку одного места, чтобы утром было чисто."""},
    ],
    "Энергия": [
        {"key": "morning", "label": "🌅 Утро",
         "why": "Первые минуты после пробуждения мозг особенно восприимчив — то, во что он попадает первым (лента, уведомления), задаёт тон всему дню через выброс кортизола и дофамина по чужому сценарию. Пауза без телефона — способ начать день на своих условиях.",
         "easy": """🌅 <b>Утро</b>
Просто не хватайся за телефон первые 5 минут после будильника. Выпей стакан воды. Это всё — этого достаточно на сегодня.""",
         "medium": """🌅 <b>Утро</b>
Первые 30 минут после пробуждения — без телефона. Сделай 5 глубоких вдохов. Выпей воды. Напиши 1 мысль, которая пришла в голову."""},
        {"key": "move", "label": "💪 Движение",
         "why": "Движение физически снижает уровень кортизола и переключает нервную систему из режима «застыл» в режим «в порядке» — этот эффект не зависит от того, тренировка это или просто танцы. Телу для сброса напряжения не всегда нужен спорт.",
         "easy": """💪 <b>Движение</b>
Пройдись 10 минут пешком в удобном темпе. Без цели, без спорта — просто прогуляйся.""",
         "medium": """💪 <b>Движение</b>
15 минут растяжки или прогулка без цели. Или танцуй под 3 любимые песни. Движение как медитация."""},
        {"key": "yoga", "label": "🧘 Йога",
         "why": "Медленное осознанное движение активирует парасимпатическую нервную систему — ту её часть, что отвечает за «отдых и восстановление», а не за «бей или беги». Это одна из немногих практик, которая работает и с телом, и с тревожным умом одновременно.",
         "easy": """🧘 <b>Йога</b>
Сделай 5-10 минут простой йоги или растяжки по любому видео — неважно, получится ли красиво.""",
         "medium": """🧘 <b>Йога</b>
Попробуй йогу 20-30 минут — новый комплекс или знакомый, если никогда не пробовал(а) раньше."""},
        {"key": "walk", "label": "🌇 Прогулка",
         "why": "Ходьба в спокойном темпе — один из немногих способов дать мозгу блуждать без цели, а именно в таком состоянии часто приходят неожиданные решения и снижается тревожность. Это не про фитнес, это про паузу без стимуляции.",
         "easy": """🌇 <b>Прогулка</b>
Выйди на 10-минутную прогулку утром или перед сном — без телефона, просто подыши воздухом.""",
         "medium": """🌇 <b>Прогулка</b>
Прогуляйся 20-30 минут утром или вечером в спокойном темпе — как ритуал, а не спорт."""},
        {"key": "sport_ritual", "label": "🏋️ Спортивный ритуал",
         "why": "Пробуя ритуал один раз, ты убираешь самый большой барьер перед новой привычкой — неопределённость «а вдруг не понравится, вдруг не смогу». Тест-драйв снимает давление обязательства, оставляя только любопытство.",
         "easy": """🏋️ <b>Спортивный ритуал</b>
Выбери один спортивный ритуал (йога, ходьба, зарядка, упражнения на осанку) и попробуй его сегодня 10 минут — тест-драйв на будущее.""",
         "medium": """🏋️ <b>Спортивный ритуал</b>
Выбери спортивный ритуал, который хочешь делать каждый день — йога, пилатес, тренировка, ходьба, зал. Сделай его сегодня в первый раз и реши, подходит ли он тебе."""},
        {"key": "cold_shower", "label": "🚿 Холодный душ",
         "why": "Резкий холод — один из немногих способов быстро и надёжно переключить нервную систему, вызывая всплеск норадреналина и бодрости без кофеина. Это буквально физиологический ресет, а не просто закаливание.",
         "easy": """🚿 <b>Холодный душ</b>
Включи холодную воду на последние 10 секунд обычного душа — просто попробуй ощущение.""",
         "medium": """🚿 <b>Холодный душ</b>
Попробуй холодный душ — или хотя бы включи холодную воду в конце обычного, на 30 секунд."""},
        {"key": "breathing", "label": "🌬 Дыхание",
         "why": "Осознанное дыхание — один из немногих сознательных «входов» в вегетативную нервную систему: замедляя выдох, ты напрямую снижаешь тревогу через блуждающий нерв. Это работает даже тогда, когда словами «успокойся» себя убедить не получается.",
         "easy": """🌬 <b>Дыхание</b>
Сделай 5 минут осознанного дыхания — просто считай вдохи и выдохи.""",
         "medium": """🌬 <b>Дыхание</b>
Проведи 10 минут в осознанном дыхании или медитации — таймер, тишина, ничего больше."""},
        {"key": "screen_free_evening", "label": "📵 Экран перед сном",
         "why": "Синий свет экранов подавляет выработку мелатонина и держит мозг в состоянии «ещё не пора спать», даже когда тело уже устало. Час без экрана перед сном — не дисциплина, это возможность заснуть быстрее и глубже.",
         "easy": """📵 <b>Экран перед сном</b>
Последние 20-30 минут перед сном — без экрана.""",
         "medium": """📵 <b>Экран перед сном</b>
Последний час перед сном — без экрана. Книга, разговор, тишина вместо телефона."""},
        {"key": "evening_stretch", "label": "🌆 Вечерняя растяжка",
         "why": "Тело весь день накапливает мышечное напряжение, о котором ты часто даже не подозреваешь, пока не начинаешь его снимать. Растяжка перед сном сигнализирует нервной системе, что день закончен и можно расслабиться.",
         "easy": """🌆 <b>Вечерняя растяжка</b>
5 минут лёгкой растяжки перед сном — просто размять тело.""",
         "medium": """🌆 <b>Вечерняя растяжка</b>
10 минут растяжки перед сном — медленно, без цели на результат."""},
        {"key": "nature_time", "label": "🌳 На природу",
         "why": "Природная среда снижает активность зоны мозга, отвечающей за руминацию — навязчивое пережёвывание мыслей, — сильнее, чем городская обстановка. Не совпадение, что после прогулки в парке в голове обычно тише.",
         "easy": """🌳 <b>На природу</b>
Проведи 10 минут на улице осознанно — сад, двор, парк — просто будь там.""",
         "medium": """🌳 <b>На природу</b>
Проведи хотя бы 20-30 минут на природе — парк, лес, вода — без телефона."""},
        {"key": "mindful_eating", "label": "🥗 Осознанная еда",
         "why": "Еда на автомате, под экран, не даёт мозгу зарегистрировать сигналы сытости и удовольствия — насыщение чувствуется слабее, даже если съедено достаточно. Осознанность здесь не про диету, а про то, чтобы еда реально ощущалась.",
         "easy": """🥗 <b>Осознанная еда</b>
Съешь хотя бы несколько первых кусочков еды медленно и осознанно, без телефона.""",
         "medium": """🥗 <b>Осознанная еда</b>
Съешь один приём пищи медленно, без телефона и экрана, замечая вкус."""},
        {"key": "active_music", "label": "🎶 Активная музыка",
         "why": "Ритмичное движение под музыку задействует одновременно моторную и эмоциональную системы мозга — один из самых быстрых способов физически сбросить накопленное напряжение. Работает даже 5-7 минут, потому что дело не в тренировке, а в переключении состояния.",
         "easy": """🎶 <b>Активная музыка</b>
5-7 минут под энергичную музыку в движении — потянись, попляши, займись мелкими делами.""",
         "medium": """🎶 <b>Активная музыка</b>
15 минут под энергичную музыку в движении — уборка, зарядка, что угодно."""},
        {"key": "sleep_ritual", "label": "🌙 Ритуал перед сном",
         "why": "Повторяющаяся последовательность действий перед сном учит нервную систему ассоциировать эти шаги с приближением отдыха — это называется якорение. Со временем сам ритуал начинает вызывать сонливость, а не только то, что ты в итоге ложишься.",
         "easy": """🌙 <b>Ритуал перед сном</b>
Добавь одно расслабляющее действие перед сном сегодня — чай, пара минут тишины, растяжка.""",
         "medium": """🌙 <b>Ритуал перед сном</b>
Создай короткий расслабляющий ритуал перед сном — чай, растяжка, дневник."""},
        {"key": "posture", "label": "🧎 Осанка",
         "why": "Осанка и эмоциональное состояние связаны в обе стороны — сутулость не просто следствие усталости, она сама поддерживает более тревожное состояние через обратную связь тела с мозгом. Выпрямившись, ты слегка меняешь и то, как себя чувствуешь.",
         "easy": """🧎 <b>Осанка</b>
В течение часа несколько раз сознательно выпрями спину и заметь разницу.""",
         "medium": """🧎 <b>Осанка</b>
Весь день сознательно следи за осанкой — лови момент, когда начинаешь сутулиться."""},
    ],
    "Саморазвитие": [
        {"key": "plan", "label": "📋 План",
         "why": "Крупная цель без разбивки на шаги перегружает рабочую память — мозг не может удержать «всё сразу» и в итоге откладывает целиком. Три конкретных шага превращают неподъёмную идею в то, с чем реально можно начать сегодня.",
         "easy": """📋 <b>План</b>
Выпиши всего 1 маленькое дело, которое сделаешь сегодня. Не список — одно. Сделай его и отметь клетку.""",
         "medium": """📋 <b>План</b>
Выпиши 1 долгосрочную цель, на которой хочешь сконцентрироваться. Разбей на 3 шага на эту неделю. Запиши в дневник."""},
        {"key": "learn", "label": "🧠 Ученик",
         "why": "Регулярная практика небольшими порциями закрепляет навык надёжнее, чем редкие длинные сессии — это называется эффектом интервального повторения. 25 минут сегодня значат больше, чем кажется, именно потому что они регулярные.",
         "easy": """🧠 <b>Ученик</b>
Потрать 10 минут на то, чему давно хочешь научиться — видео, статья, один подход. Не для результата, для начала.""",
         "medium": """🧠 <b>Ученик</b>
Выдели 25 минут осознанной практики нового навыка (учёба, язык, инструмент). Без телефона рядом."""},
        {"key": "new_hobby", "label": "🎯 Новое хобби",
         "why": "Мозг любит новизну — незнакомая деятельность активирует дофаминовую систему иначе, чем привычные дела, и это одна из причин, почему рутина со временем ощущается пресной. Пробовать новое — способ вернуть себе интерес к жизни, а не просто занять время.",
         "easy": """🎯 <b>Новое хобби</b>
Попробуй хобби, которым никогда не занимался(ась), хотя бы 15 минут — оригами, каллиграфия, вязание, лепка, что угодно новое. Не для результата.""",
         "medium": """🎯 <b>Новое хобби</b>
Выдели час на хобби, которым никогда не занимался(ась) — новое блюдо, рисование, гончарное дело, музыкальный инструмент. Просто попробуй, без цели стать хорошим."""},
        {"key": "horizons", "label": "🔭 Кругозор",
         "why": "Знакомство с чужим способом мышления — будь то философ или учёный — на время выводит тебя из привычной рамки, через которую ты обычно смотришь на мир. Это маленькая тренировка когнитивной гибкости, даже если тема кажется далёкой от повседневности.",
         "easy": """🔭 <b>Кругозор</b>
Выбери философа, учёного или религию, о которых почти ничего не знаешь. Прочитай о них 10 минут — просто вводную статью.""",
         "medium": """🔭 <b>Кругозор</b>
Выбери философа, учёного или религию — изучи основные идеи 20-30 минут (статья, видео, лекция). Запиши для себя 2-3 мысли, которые зацепили."""},
        {"key": "how_it_works", "label": "⚙️ Как это работает",
         "why": "Понимание механизма снижает тревогу перед вещами, которые казались непонятной чёрной коробкой — а непонятное мозг автоматически считывает как потенциально опасное. Разобравшись, ты убираешь один источник фонового беспокойства.",
         "easy": """⚙️ <b>Как это работает</b>
Разберись поверхностно, как работает одна вещь из повседневности — прочитай простое объяснение, без глубокого погружения.""",
         "medium": """⚙️ <b>Как это работает</b>
Разберись, как устроена одна вещь из повседневности — кофемашина, интернет, страхование — до понимания механизма."""},
        {"key": "podcast", "label": "🎧 Подкаст или лекция",
         "why": "Слушать чужие рассуждения на незнакомую тему — один из самых низкозатратных способов расширить картину мира, потому что это не требует концентрации, как чтение. Мозг усваивает новые связи даже в фоновом режиме.",
         "easy": """🎧 <b>Подкаст или лекция</b>
Послушай 10-15 минут подкаста или лекции на новую тему — не обязательно целиком.""",
         "medium": """🎧 <b>Подкаст или лекция</b>
Послушай выпуск подкаста или лекцию на незнакомую тебе тему."""},
        {"key": "mini_lesson", "label": "🧵 Мини-урок",
         "why": "Начать — самый энергозатратный момент в любом обучении, потому что именно тут больше всего сомнений и сопротивления. Как только ты внутри процесса, продолжать становится ощутимо легче — это известно как эффект Зейгарник.",
         "easy": """🧵 <b>Мини-урок</b>
Открой курс, который давно отложен, и посмотри хотя бы первые 10 минут урока.""",
         "medium": """🧵 <b>Мини-урок</b>
Начни или продолжи один урок онлайн-курса, который давно отложен."""},
        {"key": "quiz", "label": "🧠 Викторина",
         "why": "Проверка знаний в игровой форме задействует тот же дофаминовый отклик, что и любая игра — мозг реагирует на маленькие победы, даже если ставки не настоящие. Это делает обучение более цепляющим, чем просто чтение фактов.",
         "easy": """🧠 <b>Викторина</b>
Пройди короткую викторину (5-10 вопросов) на любую тему, которая интересна.""",
         "medium": """🧠 <b>Викторина</b>
Пройди тест или квиз на новую для себя тему — проверь, что реально знаешь."""},
        {"key": "geography", "label": "🗺 География",
         "why": "Мозг лучше запоминает информацию, когда она связана с конкретным образом — картой, местом, — а не абстрактным текстом. География даёт знаниям физическую точку опоры в голове, поэтому они держатся дольше.",
         "easy": """🗺 <b>География</b>
Найди на карте страну, о которой ничего не знаешь, и прочитай 3-5 фактов о ней.""",
         "medium": """🗺 <b>География</b>
Найди на карте страну или город, о которых ничего не знаешь, и изучи основные факты."""},
        {"key": "fact_of_day", "label": "🔬 Факт дня",
         "why": "Удивление — один из самых сильных триггеров внимания и запоминания, потому что мозг помечает неожиданную информацию как важную. Один яркий факт может закрепиться лучше, чем час скучного чтения.",
         "easy": """🔬 <b>Факт дня</b>
Найди один интересный факт (любая тема) и прочитай о нём коротко.""",
         "medium": """🔬 <b>Факт дня</b>
Узнай один научный факт, который тебя удивит, и запомни его."""},
        {"key": "self_debate", "label": "💬 Дебаты с собой",
         "why": "Формулируя аргументы против собственного мнения, ты тренируешь способность видеть ситуацию с нескольких сторон — а это прямо противоположно тому, как работает предвзятость подтверждения, которая обычно управляет взглядами незаметно.",
         "easy": """💬 <b>Дебаты с собой</b>
Выбери спорный вопрос и напиши по 1 аргументу за и против.""",
         "medium": """💬 <b>Дебаты с собой</b>
Выбери спорный вопрос и напиши аргументы за и против — даже если мнение уже есть."""},
    ],
    "Смелость": [
        {"key": "fear", "label": "😨 Страх",
         "why": "Страх перед конкретным действием почти всегда сильнее, чем ощущения во время самого действия — это известное искажение прогноза. Признать страх вслух — первый шаг к тому, чтобы разница между воображаемым и реальным стала заметна.",
         "easy": """😨 <b>Страх</b>
Назови вслух или запиши одну вещь, которую боишься сделать. Не делай — просто признай это себе. Это уже шаг.""",
         "medium": """😨 <b>Страх</b>
Сделай то, что давно боишься: звонок важному человеку, признание, первый шаг к цели. Не ищи идеального момента — просто начни."""},
        {"key": "challenge", "label": "🔥 Испытание",
         "why": "Каждый раз, когда ты выходишь за пределы привычного и ничего катастрофического не происходит, мозг понемногу пересматривает свою карту «что безопасно». Так и расширяется зона комфорта — не одним рывком, а повторением маленьких доказательств.",
         "easy": """🔥 <b>Испытание</b>
Попробуй сегодня блюдо, музыку или фильм, которые обычно не выбрал бы. Маленький эксперимент — не подвиг.""",
         "medium": """🔥 <b>Испытание</b>
Согласись на то, что обычно отклонил бы. Или скажи «да» спонтанному предложению. Даже если неуверен. Запиши, что произошло."""},
        {"key": "say_no", "label": "🙅 Скажи «нет»",
         "why": "Привычка соглашаться из вежливости со временем стирает границу между тем, что ты выбираешь, и тем, что тебе навязывают — и это истощает сильнее, чем сам отказ когда-либо мог бы. Один честный «нет» тренирует мышцу, которая давно не использовалась.",
         "easy": """🙅 <b>Скажи «нет»</b>
Откажи в чём-то маленьком, в чём обычно соглашаешься из вежливости.""",
         "medium": """🙅 <b>Скажи «нет»</b>
Откажи кому-то или чему-то, чему обычно уступаешь — вежливо, но твёрдо."""},
        {"key": "ask_help", "label": "🆘 Попроси о помощи",
         "why": "Просьба о помощи ощущается как уязвимость, но чаще всего усиливает, а не ослабляет доверие в отношениях — люди склонны хуже думать о тех, кто просит, только в собственном воображении просящего, не в реальности. Это несовпадение стоит проверить на практике.",
         "easy": """🆘 <b>Попроси о помощи</b>
Попроси о маленькой помощи — совет, минутная услуга — у того, кого обычно не беспокоишь по мелочам.""",
         "medium": """🆘 <b>Попроси о помощи</b>
Обратись за помощью в том, что обычно решаешь сам(а) — коллега, друг, специалист."""},
        {"key": "opinion", "label": "🗣 Своё мнение",
         "why": "Каждый раз, когда ты молчишь вместо того чтобы высказаться, подкрепляется убеждение «моё мнение не так важно» — это работает как самосбывающийся паттерн. Высказавшись один раз в безопасной ситуации, ты начинаешь его расшатывать.",
         "easy": """🗣 <b>Своё мнение</b>
Выскажи своё мнение в маленьком, безопасном разговоре, где обычно просто соглашаешься.""",
         "medium": """🗣 <b>Своё мнение</b>
Выскажи своё мнение там, где обычно промолчал(а) бы — в разговоре, чате, комментарии."""},
        {"key": "unfiltered", "label": "📸 Без фильтров",
         "why": "Постоянная ретушь и фильтры формируют разрыв между тем, как ты выглядишь на самом деле, и тем, что привык видеть — и этот разрыв со временем усиливает тревогу о внешности, а не снижает её. Показать себя настоящего — способ сократить эту дистанцию.",
         "easy": """📸 <b>Без фильтров</b>
Сохрани (не обязательно публикуя) фото или видео себя таким, какой(ая) есть — без фильтров и подготовки.""",
         "medium": """📸 <b>Без фильтров</b>
Опубликуй фото или видео, каким обычно постеснялся(ась) бы поделиться — без ретуши и долгих раздумий."""},
        {"key": "improvise", "label": "🎭 Импровизация",
         "why": "Долгая подготовка часто маскирует не заботу о качестве, а попытку контролировать неопределённость — и это истощает больше, чем сама задача. Импровизация тренирует способность выдерживать неопределённость напрямую, без брони из подготовки.",
         "easy": """🎭 <b>Импровизация</b>
Ответь на маленький вопрос или ситуацию сходу, без обдумывания — доверься первой реакции.""",
         "medium": """🎭 <b>Импровизация</b>
Сделай что-то без подготовки, на что обычно долго готовишься — доклад, звонок, встречу."""},
        {"key": "compliment_stranger", "label": "🎯 Комплимент незнакомцу",
         "why": "Искренний комплимент незнакомцу снижает социальную тревогу быстрее, чем кажется, потому что фокус внимания смещается с себя («как я выгляжу») на другого человека («что хорошего я заметил»). Это простой способ выйти из головы в контакт.",
         "easy": """🎯 <b>Комплимент незнакомцу</b>
Скажи комплимент человеку, которого немного знаешь, но обычно не хвалишь — коллеге, знакомому.""",
         "medium": """🎯 <b>Комплимент незнакомцу</b>
Скажи искренний комплимент человеку, которого не знаешь — продавцу, соседу."""},
        {"key": "confession", "label": "📝 Признание",
         "why": "То, что скрывается, обычно занимает в голове больше места, чем то, что произнесено вслух — секреты требуют постоянного фонового контроля, чтобы случайно не всплыть. Признание снимает именно эту нагрузку, независимо от реакции на него.",
         "easy": """📝 <b>Признание</b>
Признайся себе в чём-то, что обычно не проговариваешь даже наедине с собой.""",
         "medium": """📝 <b>Признание</b>
Признайся себе или кому-то в том, что обычно скрываешь."""},
    ],
    "Приключения": [
        {"key": "adventure1", "label": "🌍 Приключение",
         "why": "Смена физического окружения — один из самых быстрых способов создать новые нейронные ассоциации и слегка «встряхнуть» привычный ход мыслей. Мозгу не нужно далеко ехать для эффекта новизны — важна именно непривычность, а не расстояние.",
         "easy": """🌍 <b>Приключение</b>
Съезди в место рядом, где никогда не был — соседний район, парк, набережная. Просто смени обстановку на час.""",
         "medium": """🌍 <b>Приключение</b>
Съезди куда-то новое — на природу, в соседний город, в интересное место, которое давно откладывал(а). Можно с пикником. Главное — смена обстановки."""},
        {"key": "random", "label": "🎲 Рандом",
         "why": "Живые впечатления (в отличие от просмотра с экрана) задействуют больше сенсорных каналов одновременно, и мозг помечает такие моменты как более значимые и лучше их запоминает. Поэтому живой концерт помнится дольше, чем сто просмотренных видео.",
         "easy": """🎲 <b>Рандом</b>
Найди что-то, что давно хотел(а) попробовать, но откладывал(а) — и сделай хотя бы маленький первый шаг сегодня.""",
         "medium": """🎲 <b>Рандом</b>
Сходи на что-то живое — выставку, концерт, спектакль, стендап. Что-то, что смотрят и слушают вживую, а не с экрана."""},
        {"key": "magic_trick", "label": "🎩 Фокус",
         "why": "Освоение небольшого конкретного навыка с понятным результатом — редкая возможность увидеть прогресс наглядно и быстро, в отличие от большинства целей, где результат отложен. Это маленькая, но настоящая доза «у меня получилось».",
         "easy": """🎩 <b>Фокус</b>
Найди на видео простой фокус с картами или монетой и разучи основы — 15 минут, без цели сразу кому-то показывать.""",
         "medium": """🎩 <b>Фокус</b>
Разучи один фокус целиком — потренируйся, пока не начнёт получаться гладко."""},
        {"key": "new_food", "label": "🍜 Новая еда",
         "why": "Незнакомый вкус — один из самых безопасных и доступных способов дать мозгу дозу новизны без реального риска. Это тренирует готовность пробовать неизвестное в миниатюре, прежде чем переносить эту готовность на более серьёзные вещи.",
         "easy": """🍜 <b>Новая еда</b>
Попробуй один новый продукт или блюдо, которое никогда не пробовал(а) — маленькая порция достаточно.""",
         "medium": """🍜 <b>Новая еда</b>
Попробуй блюдо кухни, которую никогда не пробовал(а) — приготовь или закажи."""},
        {"key": "solo_trip", "label": "🚶 Соло-вылазка",
         "why": "Время в одиночестве в новом контексте даёт доступ к мыслям и предпочтениям, которые обычно теряются в компании — когда не на кого ориентироваться, приходится ориентироваться на себя. Это не про одиночество, это про то, чтобы услышать, чего хочешь именно ты.",
         "easy": """🚶 <b>Соло-вылазка</b>
Сходи один(одна) в кафе или на короткую прогулку — куда обычно идёшь с кем-то.""",
         "medium": """🚶 <b>Соло-вылазка</b>
Сходи куда-то один(одна), куда обычно ходишь с кем-то — кафе, кино, прогулка."""},
        {"key": "reverse_route", "label": "🔄 Маршрут наоборот",
         "why": "Мозг склонен переводить хорошо знакомые маршруты в автопилот и переставать их вообще замечать — это называется привыканием восприятия. Изменение направления заставляет обратить внимание на то, что обычно проходит мимо сознания.",
         "easy": """🔄 <b>Маршрут наоборот</b>
Сверни один раз не туда, куда обычно, на привычном маршруте — и посмотри, куда это приведёт.""",
         "medium": """🔄 <b>Маршрут наоборот</b>
Пройди привычный маршрут в обратную сторону или другим путём — замечай, что выглядит иначе."""},
        {"key": "mystery_ticket", "label": "🎟 Билет в один конец",
         "why": "Отказ от заранее известного результата снижает тревогу ожидания — ту, что обычно возникает из желания всё контролировать. Это тренирует переносимость неопределённости в safe-формате: развлечение с непредсказуемым, но не опасным исходом.",
         "easy": """🎟 <b>Билет в один конец</b>
Найди афишу мероприятий на сегодня-завтра и выбери одно случайно, не читая подробностей — просто реши сходить.""",
         "medium": """🎟 <b>Билет в один конец</b>
Купи билет на случайное мероприятие сегодня-завтра, не выбирая заранее, что это будет."""},
        {"key": "random_route", "label": "🚏 Случайный маршрут",
         "why": "Небольшое, безопасное отклонение от привычного маршрута — способ практиковать спонтанность в контролируемых дозах, прежде чем решаться на более крупные незапланированные вещи. Мозг учится, что непредсказуемое не обязательно означает плохое.",
         "easy": """🚏 <b>Случайный маршрут</b>
Сверни один раз наугад на прогулке, не глядя на карту, и посмотри, куда это приведёт.""",
         "medium": """🚏 <b>Случайный маршрут</b>
Сядь в случайный транспорт или сверни на случайной остановке и посмотри, куда попадёшь."""},
        {"key": "sunrise_sunset", "label": "🌅 Рассвет или закат",
         "why": "Наблюдение за медленным, некликабельным процессом — редкий опыт в жизни, полной моментальной стимуляции, и именно поэтому он особенно хорошо восстанавливает способность к спокойному вниманию. Закат не ускоришь и не пропустишь вперёд — в этом его ценность.",
         "easy": """🌅 <b>Рассвет или закат</b>
Застань рассвет или закат — даже из окна или с балкона, просто замечай его 5 минут.""",
         "medium": """🌅 <b>Рассвет или закат</b>
Застань рассвет или закат в непривычном месте — без телефона, просто наблюдай."""},
        {"key": "local_landmark", "label": "🎡 Местная достопримечательность",
         "why": "Взгляд туриста на знакомое место включает то же любопытство, что обычно требует поездки за тысячи километров — но здесь достаточно просто посмотреть иначе. Это доказывает, что новизна больше зависит от внимания, чем от расстояния.",
         "easy": """🎡 <b>Местная достопримечательность</b>
Узнай о туристическом месте в своём городе, где никогда не был(а) — просто загугли, что там.""",
         "medium": """🎡 <b>Местная достопримечательность</b>
Сходи туда, куда обычно водят туристов в твоём городе, но ты сам(а) не был(а)."""},
        {"key": "new_transport", "label": "🚲 Новый транспорт",
         "why": "Смена привычного способа передвижения меняет темп и ракурс восприятия окружения — то, что обычно проносится мимо на автомате, вдруг становится заметным. Это дешёвый способ почувствовать, что день был не таким, как всегда.",
         "easy": """🚲 <b>Новый транспорт</b>
Пройди пешком хотя бы часть пути, который обычно проезжаешь.""",
         "medium": """🚲 <b>Новый транспорт</b>
Передвигайся сегодня непривычным способом — велосипед, самокат, пешком вместо машины."""},
        {"key": "spontaneous_meetup", "label": "🎫 Спонтанная встреча",
         "why": "Спонтанные встречи не требуют долгого согласования и подготовки — и именно поэтому снижают барьер для социального контакта, который в запланированном виде может ощущаться как обязательство. Иногда лёгкость важнее качества плана.",
         "easy": """🎫 <b>Спонтанная встреча</b>
Напиши кому-то с предложением спонтанно встретиться сегодня или завтра, без долгого планирования.""",
         "medium": """🎫 <b>Спонтанная встреча</b>
Прими спонтанное приглашение, если оно появится сегодня — или сам(а) создай повод для встречи."""},
    ],
    "Творчество": [
        {"key": "expression", "label": "✨ Проявление",
         "why": "Визуальное творчество задействует области мозга, не связанные с речью — иногда то, что сложно сформулировать словами, проще выразить линией или формой. Рисунок необязательно должен быть хорошим, чтобы сработать как канал для того, что накопилось.",
         "easy": """✨ <b>Проявление</b>
Нарисуй что-то маленькое — эскиз, каракули, один предмет вокруг тебя. Неважно, умеешь ты рисовать или нет.""",
         "medium": """✨ <b>Проявление</b>
Нарисуй что-то — неважно, умеешь ты рисовать или нет. Эскиз, зарисовка, каракули с смыслом. 15-20 минут, без цели на результат."""},
        {"key": "writing", "label": "✍️ Письмо",
         "why": "Свободное письмо без цели и структуры снижает внутреннюю самоцензуру — когда не нужно писать «правильно», мысли и чувства выходят честнее, чем в обычном разговоре с собой. Это ближе к разгрузке, чем к литературе.",
         "easy": """✍️ <b>Письмо</b>
Напиши 5 минут в свободной форме — что угодно, без структуры и цели. Просто дай руке писать.""",
         "medium": """✍️ <b>Письмо</b>
Напиши что-то не для дела — письмо (можно не отправлять), короткий рассказ, страницу из воображаемого дневника. 15 минут свободного письма."""},
        {"key": "photo_project", "label": "📷 Фотопроект",
         "why": "Поиск одной темы весь день меняет режим внимания — вместо рассеянного сканирования мозг начинает целенаправленно замечать детали, которые обычно проходят мимо. Фотография здесь — просто повод смотреть внимательнее.",
         "easy": """📷 <b>Фотопроект</b>
Сделай 3 фото на одну тему сегодня — просто наблюдай и снимай.""",
         "medium": """📷 <b>Фотопроект</b>
Сделай серию из 5-10 фото на одну тему за день — свет, цвет, эмоция, что угодно одно."""},
        {"key": "cook_creative", "label": "🍳 Готовка как творчество",
         "why": "Готовка без рецепта задействует то же импровизационное мышление, что и любое творчество, но с низкими ставками — если не получится, это просто ужин, а не провал проекта. Это безопасная площадка для тренировки спонтанных решений.",
         "easy": """🍳 <b>Готовка как творчество</b>
Добавь одно неожиданное сочетание в привычное блюдо — маленький эксперимент на кухне.""",
         "medium": """🍳 <b>Готовка как творчество</b>
Приготовь блюдо без рецепта, по вдохновению — из того, что есть дома."""},
        {"key": "collage", "label": "🖼 Коллаж",
         "why": "Собирание визуальных фрагментов в одно целое — способ увидеть на бумаге то, что обычно остаётся смутным чувством внутри. Иногда коллаж говорит о состоянии человека больше, чем он сам мог бы сформулировать словами.",
         "easy": """🖼 <b>Коллаж</b>
Сохрани 5-10 картинок или вырежи вырезки, которые вдохновляют прямо сейчас — без цели их куда-то собирать.""",
         "medium": """🖼 <b>Коллаж</b>
Сделай коллаж или мудборд из того, что вдохновляет тебя прямо сейчас — бумага или экран."""},
        {"key": "rearrange_space", "label": "🪴 Пересобери пространство",
         "why": "Физическое окружение подсознательно сигнализирует мозгу о статусе дел в жизни — застоявшееся пространство читается как застой в целом. Изменение расстановки — простой способ создать ощущение перемены, не дожидаясь больших изменений.",
         "easy": """🪴 <b>Пересобери пространство</b>
Переставь несколько мелких вещей на столе или полке — новый порядок, новый вид.""",
         "medium": """🪴 <b>Пересобери пространство</b>
Переставь мебель или декор в одной комнате или уголке — по-новому."""},
        {"key": "role_play", "label": "🎭 Роль",
         "why": "Примерка непривычного образа на время снимает часть социальных ограничений, которые обычно держат поведение в рамках — недаром именно в непривычной одежде люди часто ведут себя чуть смелее. Это маленький эксперимент с тем, «а что если бы я был другим».",
         "easy": """🎭 <b>Роль</b>
Добавь одну непривычную деталь в свой образ сегодня — цвет, аксессуар, мелочь.""",
         "medium": """🎭 <b>Роль</b>
Примерь непривычный для себя стиль или образ на день — одежда, причёска, манера."""},
        {"key": "handicraft", "label": "🧵 Рукоделие",
         "why": "Работа руками задействует моторную кору мозга способом, который переключает с руминации на настоящий момент — трудно одновременно тревожиться и внимательно вырезать или лепить. Это одна из причин, почему рукоделие традиционно успокаивает.",
         "easy": """🧵 <b>Рукоделие</b>
Сделай что-то простое руками за 10-15 минут из того, что есть под рукой.""",
         "medium": """🧵 <b>Рукоделие</b>
Попробуй что-то сделать руками из подручных материалов — без цели на результат."""},
        {"key": "sing", "label": "🎤 Пой",
         "why": "Пение задействует дыхание, вибрацию голосовых связок и эмоциональные центры мозга одновременно — это физически меняет состояние нервной системы, а не просто «поднимает настроение» метафорически. Громкость и разрешение фальшивить — часть эффекта, не помеха ему.",
         "easy": """🎤 <b>Пой</b>
Подпевай любимой песне вслух хотя бы куплет, даже вполголоса.""",
         "medium": """🎤 <b>Пой</b>
Спой любимую песню в полный голос, когда никто не слышит."""},
        {"key": "upcycle", "label": "✂️ Переделка",
         "why": "Придание новой жизни ненужной вещи — маленькая практика в том, чтобы видеть потенциал там, где на первый взгляд его нет. Этот же навык переноса перспективы работает и на менее материальные вещи в жизни.",
         "easy": """✂️ <b>Переделка</b>
Найди одну ненужную вещь и придумай, как её переделать — не обязательно делать сегодня, просто придумай.""",
         "medium": """✂️ <b>Переделка</b>
Переделай старую вещь во что-то новое — дай ей вторую жизнь."""},
        {"key": "atmosphere", "label": "🕯 Атмосфера",
         "why": "Обстановка вокруг напрямую влияет на эмоциональное состояние через органы чувств — свет, запах и звук воздействуют на нервную систему быстрее, чем сознательные мысли. Создать атмосферу — способ настроить себя не уговорами, а средой.",
         "easy": """🕯 <b>Атмосфера</b>
Смени освещение или включи музыку под настроение прямо сейчас — маленький штрих.""",
         "medium": """🕯 <b>Атмосфера</b>
Создай особую атмосферу дома — свет, запахи, музыка — просто для настроения, без повода."""},
    ],
}

KEY_TO_LABEL = {t["key"]: t["label"] for tasks in BINGO_BANK.values() for t in tasks}
KEY_TO_SPHERE = {t["key"]: sphere for sphere, tasks in BINGO_BANK.items() for t in tasks}
KEY_TO_TASK = {t["key"]: t for tasks in BINGO_BANK.values() for t in tasks}

def get_doubled_spheres(week: int) -> set:
    """Какие 3 из 6 сфер дают 2 клетки на этой неделе (остальные 3 дают по 1).
    Чередуется по чётности недели, так что за 2 недели все сферы равны."""
    group_a = set(BINGO_SPHERES[:3])
    group_b = set(BINGO_SPHERES[3:])
    return group_a if week % 2 == 1 else group_b

def build_personal_bingo(scores: dict, week: int = 1, user_id: int = 0, regen: int = 0) -> dict:
    """Собирает карту на неделю: 9 клеток, сбалансированных по 6 сферам с
    ротацией «удвоенных» сфер (1 или 2 слота на сферу). Внутри сферы конкретные
    задания выбираются случайно из её пула (пулы разного размера — например,
    у Дисциплины сейчас 6 кандидатов, у остальных по 2). Каждой клетке — уровень
    сложности по баллу сферы (лёгкий/средний). Всё выбирается детерминированно
    по (user_id, week, regen), так что карта не меняется при каждом обновлении в
    течение одной недели — но меняется, если пользователь явно перегенерировал
    её кнопкой (regen увеличивается)."""
    rng = random.Random(f"{user_id}-{week}-{regen}")
    doubled = get_doubled_spheres(week)
    active_keys = []
    for sphere in BINGO_SPHERES:
        tasks = BINGO_BANK[sphere]
        slot_count = min(2 if sphere in doubled else 1, len(tasks))
        chosen = rng.sample(tasks, slot_count)
        active_keys.extend([t["key"] for t in chosen])

    card = {}
    for key in active_keys:
        task = KEY_TO_TASK[key]
        sphere = KEY_TO_SPHERE[key]
        sphere_score = scores.get(sphere, 50) if scores else 50
        tier = "easy" if sphere_score < 50 else "medium"
        card[key] = {"text": task[tier], "tier": tier}
    return card

LLM_REFRESH_EVERY_N_WEEKS = 2

async def refresh_card_via_llm(user_id: int, base_card: dict) -> dict:
    """Переписывает текст заданий через Groq, сохраняя структуру (сфера и
    уровень сложности) как есть — LLM только освежает формулировки и
    старается не повторять недавно выполненные темы. При любой ошибке или
    некорректном ответе тихо откатывается на базовый (банковский) текст."""
    profile, _ = get_user_profile(user_id)
    recent = get_recent_completed_texts(user_id, limit=8)
    recent_text = "\n".join(f"- {t}" for t in recent) if recent else "(пока ничего не выполнено)"

    cells_spec = []
    for key, info in base_card.items():
        task = KEY_TO_TASK[key]
        sphere = KEY_TO_SPHERE[key]
        tier = info["tier"]
        cells_spec.append(f"- key={key}, сфера={sphere}, уровень={tier}, ориентир по масштабу: {task[tier]}")
    cells_text = "\n".join(cells_spec)

    prompt = f"""Ты пишешь короткие задания для бинго-карты личностного роста.
Профиль человека: {profile or "нет данных"}

Уже выполненные задания за последнее время (не повторяй эти темы и формулировки):
{recent_text}

Перепиши текст задания для каждой из следующих клеток. Сохрани сферу и уровень сложности каждой клетки — новое задание должно быть примерно того же масштаба, что и «ориентир», не легче и не тяжелее:
{cells_text}

Требования к стилю: сухо и коротко, 1-2 предложения. Только суть задания, без личных обращений и объяснений «почему». Только по-русски.

Верни ТОЛЬКО JSON вида {{"key1": "текст задания", "key2": "текст задания", ...}} — по одному полю на каждый key из списка выше."""

    try:
        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "Пишешь короткие, конкретные задания на русском. Сухо, без личных обращений и без объяснений — только суть задания."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
            max_tokens=900
        )
        content = response.choices[0].message.content
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        result = json.loads(content[json_start:json_end])

        new_card = {}
        for key, info in base_card.items():
            body = result.get(key)
            if not body or not isinstance(body, str):
                new_card[key] = info  # откат на банк для этой конкретной клетки
                continue
            label = KEY_TO_LABEL.get(key, key)
            emoji, _, word = label.partition(" ")
            header = f"{emoji} <b>{word}</b>" if word else label
            new_card[key] = {"text": f"{header}\n{body.strip()}", "tier": info["tier"]}
        return new_card
    except Exception as e:
        print(f"LLM card refresh failed, falling back to bank: {e}")
        return base_card

async def build_weekly_card(user_id: int, scores: dict, week: int) -> dict:
    """Структура карты всегда считается банком (предсказуемо, бесплатно).
    Раз в LLM_REFRESH_EVERY_N_WEEKS недель текст заданий освежается через LLM."""
    regen = get_card_regens(user_id)
    base_card = build_personal_bingo(scores, week, user_id, regen)
    if week % LLM_REFRESH_EVERY_N_WEEKS == 0:
        return await refresh_card_via_llm(user_id, base_card)
    return base_card

# Латиница, китайский/японский/корейский — если это встретилось в ответе модели,
# значит она сорвалась в другой язык, несмотря на инструкцию. Профиль в таком
# виде показывать нельзя.
_FOREIGN_SCRIPT_RE = re.compile(r'[a-zA-Z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]')

def _has_foreign_script(text: str) -> bool:
    return bool(_FOREIGN_SCRIPT_RE.search(text))

async def _call_profile_llm(prompt: str):
    response = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": "Ты — тёплый друг с психологическим образованием. Объясняешь механизмы поведения, а не оцениваешь их. Пишешь только на русском, от второго лица, без ярлыков и осуждения. Ни одного слова не на русском языке — ни на английском, ни на любом другом."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=800
    )
    content = response.choices[0].message.content
    json_start = content.find("{")
    json_end = content.rfind("}") + 1
    result = json.loads(content[json_start:json_end])
    profile_text = result.get("profile_text", "Профиль создан.")
    scores = result.get("scores", {})
    return profile_text, scores

async def _generate_profile_json(prompt: str):
    """Запрашивает профиль у Groq и проверяет результат на посторонние алфавиты
    (модель иногда срывается в другой язык, несмотря на инструкцию). При
    обнаружении — одна повторная попытка с усиленным напоминанием; если и она
    не прошла проверку — поднимает исключение, чтобы сработал безопасный
    запасной текст в generate_and_send_profile, а не битый результат."""
    profile_text, scores = await _call_profile_llm(prompt)
    if _has_foreign_script(profile_text):
        retry_prompt = prompt + "\n\nВАЖНО: предыдущая попытка содержала слова не на русском языке — это недопустимо. Проверь каждое слово перед ответом: только кириллица."
        profile_text, scores = await _call_profile_llm(retry_prompt)
        if _has_foreign_script(profile_text):
            raise ValueError("Модель дважды вернула текст с посторонними алфавитами")
    return profile_text, scores

async def generate_and_send_profile(message, user_id: int):
    answers = get_all_answers(user_id)

    readable_lines = []
    for q in SURVEY_QUESTIONS:
        value = answers.get(q["id"])
        if value is None:
            continue
        option_label = next((label for label, v in q["options"] if v == value), None)
        if option_label is None:
            continue
        sphere_plain = q["sphere"].split(" ", 1)[-1]  # strip the leading emoji
        readable_lines.append(f"[{sphere_plain}] {q['question']} → {option_label}")
    answers_text = "\n".join(readable_lines)

    prompt = f"""Ты — тёплый друг с психологическим образованием, который умеет объяснять поведение человека, а не оценивать его. Я прошла опрос из 15 вопросов.
Вот мои вопросы и выбранные ответы:
{answers_text}

Напиши мой психологический профиль — 4-6 предложений, от второго лица («ты»), только по-русски, без иностранных слов.

Требования к тексту:
- Не описывай, ЧТО происходит («ты откладываешь дела», «у тебя мало энергии») — объясни МЕХАНИЗМ: какую внутреннюю задачу решает это поведение, от чего оно защищает или что даёт взамен. Пример логики: не «ты прокрастинируешь», а «когда нет ничего, что цепляет, любой выбор кажется одинаково бессмысленным — и мозг выбирает то, что вообще не требует выбора».
- Ноль оценочных и обвиняющих слов: никаких «лень», «слабоволие», «не смог», «проблема с...». Это наблюдение, а не диагноз и не приговор.
- Обязательно сошлись на 1-2 конкретные детали из моих реальных ответов (перефразируй их своими словами) — профиль должен ощущаться как «меня узнали», а не как гороскоп, подходящий всем.
- Тон дружеский и тёплый, но не поверхностный — как будто человек прошёл хороший тест и узнал о себе что-то настоящее.
- Последним предложением сделай мостик к бинго-карте: объясни, почему задания в ней подобраны именно так (например, маленькие и конкретные, а не абстрактные) — но не описывай сами задания, их я пришлю следующим сообщением.

Также оцени по 6 сферам в процентах (0-100%): где по ответам сильнее выражена нехватка/сложность (низкий %), а где уверенность (высокий %). Сферы: Дисциплина, Энергия, Саморазвитие, Смелость, Приключения, Творчество.

Верни ТОЛЬКО JSON в таком формате:
{{"profile_text": "...", "scores": {{"Дисциплина": 58, "Энергия": 83, "Саморазвитие": 40, "Смелость": 65, "Приключения": 72, "Творчество": 50}}}}"""

    try:
        profile_text, scores = await _generate_profile_json(prompt)

        # Формируем текст профиля: фиксированный порядок сфер, короткая
        # полоска из 5 делений + точный процент
        scores_lines = []
        for sphere in BINGO_SPHERES:
            v = scores.get(sphere, 0)
            filled = max(0, min(5, round(v / 20)))
            bar = "●" * filled + "○" * (5 - filled)
            emoji = SPHERE_EMOJI.get(sphere, "")
            scores_lines.append(f"{emoji} {sphere:<14} {bar}  {v}%")
        scores_text = "\n".join(scores_lines)

        full_profile = f"""🎯 <b>Твой профиль</b>

{profile_text}

📊 <b>Сферы:</b>
<pre>{scores_text}</pre>

<i>Теперь — твоя бинго-карта на неделю. Выполняй в любом порядке. Зачеркивай клетки.</i>"""

        week = get_user_week(user_id)
        personal_card = await build_weekly_card(user_id, scores, week)
        save_user_profile(user_id, profile_text, json.dumps(scores, ensure_ascii=False), json.dumps(personal_card, ensure_ascii=False))

        await message.edit_text(full_profile, parse_mode="HTML")

        # Отправляем бинго-карту отдельным сообщением
        await send_bingo_card(message, user_id)

    except Exception as e:
        print(f"Error generating profile: {e}")
        # Fallback — отправляем шаблонную карту (без персонализации по баллам)
        week = get_user_week(user_id)
        personal_card = await build_weekly_card(user_id, {}, week)
        fallback_text = (
            "Иногда дело не в мотивации, а в моменте выбора: когда вариантов много, а ни один не цепляет, "
            "мозг выбирает то, что вообще не требует решения — и это нормальная реакция, а не слабость. "
            "Поэтому в карте — не абстрактные цели, а маленькие конкретные шаги, с которых легко начать, не выбирая."
        )
        save_user_profile(user_id, fallback_text, json.dumps({}), json.dumps(personal_card, ensure_ascii=False))
        await message.edit_text(
            f"🎯 <b>Твой профиль</b>\n\n{fallback_text}\n\n"
            "🎲 <b>Твоя бинго-карта на неделю:</b>",
            parse_mode="HTML"
        )
        await send_bingo_card(message, user_id)

# Приставка по уровню сложности — добавляется к объяснению механизма («why»)
# на экране конкретного задания. medium ничего не добавляет — объяснение
# самодостаточно; easy поясняет, почему маленький шаг тоже работает.
TIER_FRAMING = {
    "easy": " Маленький шаг здесь работает не хуже большого — главное сдвинуть паттерн, а не совершить подвиг.",
    "medium": "",
}

def _card_text(entry) -> str:
    """Достаёт текст задания из значения карты — поддерживает и новый формат
    {"text":..., "tier":...}, и старый плоский текст (для карт, сохранённых
    до этого обновления)."""
    return entry["text"] if isinstance(entry, dict) else entry

def _card_tier(entry) -> str:
    return entry["tier"] if isinstance(entry, dict) else "medium"

async def send_bingo_card(message, user_id: int):
    week = get_user_week(user_id)
    completed = get_completed_cells(user_id, week)
    streak = get_streak(user_id)
    card = get_bingo_card(user_id)
    if not card:
        card = await build_weekly_card(user_id, get_user_scores(user_id), week)
        save_bingo_card(user_id, card)

    header = f"🎲 <b>Бинго-карта — неделя {week}</b> ({len(completed)}/{len(card)})"
    if streak:
        header += f"  🔥 {streak}"

    lines = [header]
    for key, entry in card.items():
        prefix = "✅ " if key in completed else ""
        lines.append(f"{prefix}{_card_text(entry)}")
    lines.append("Нажми на клетку, чтобы отметить выполнение 👇")

    await message.answer(
        "\n\n".join(lines),
        parse_mode="HTML",
        reply_markup=build_bingo_keyboard(list(card.keys()), completed)
    )

# ==================== BINGO INTERACTION ====================
@dp.callback_query(F.data.startswith("bingo_cell_"))
async def handle_bingo_click(callback: CallbackQuery, state: FSMContext):
    cell = callback.data.replace("bingo_cell_", "")
    user_id = callback.from_user.id
    week = get_user_week(user_id)

    if cell in get_completed_cells(user_id, week):
        await callback.answer("Эта клетка уже отмечена на этой неделе ✅")
        return

    card = get_bingo_card(user_id)
    entry = card.get(cell)
    task_text = _card_text(entry) if entry else KEY_TO_TASK.get(cell, {}).get("medium", "Задание")
    tier = _card_tier(entry) if entry else "medium"

    why = KEY_TO_TASK.get(cell, {}).get("why", "")
    why_block = f"\n\n💡 {why}{TIER_FRAMING.get(tier, '')}" if why else ""

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Выполнено!", callback_data=f"complete_{cell}")],
        [InlineKeyboardButton(text="« Назад к карте", callback_data="back_to_bingo")]
    ])

    await callback.message.edit_text(task_text + why_block, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("complete_"))
async def complete_task(callback: CallbackQuery):
    cell = callback.data.replace("complete_", "")
    user_id = callback.from_user.id
    week = get_user_week(user_id)

    if cell in get_completed_cells(user_id, week):
        await callback.answer("Эта клетка уже отмечена на этой неделе ✅")
        return

    card = get_bingo_card(user_id)
    entry = card.get(cell)
    task_text = _card_text(entry) if entry else KEY_TO_TASK.get(cell, {}).get("medium", "Задание")

    save_completed_task(user_id, cell, task_text, week=week)
    touch_activity(user_id)

    completed = get_completed_cells(user_id, week)

    if len(completed) >= len(card):
        streak = get_streak(user_id)
        await callback.message.edit_text(
            f"🏆 <b>Неделя {week} закрыта!</b>\n\n"
            f"Все {len(card)} клеток пройдены. Стрик: {streak} 🔥\n\n"
            "Собираю карту на следующую неделю...",
            parse_mode="HTML"
        )
        advance_week(user_id)
        new_week = get_user_week(user_id)
        scores = get_user_scores(user_id)
        new_card = await build_weekly_card(user_id, scores, new_week)
        save_bingo_card(user_id, new_card)
        await send_bingo_card(callback.message, user_id)
    else:
        await callback.message.edit_text(
            f"✅ <b>Клетка выполнена!</b>\n\n{task_text}\n\n"
            f"Отличная работа! Продолжай в том же духе.",
            parse_mode="HTML"
        )
        await send_bingo_card(callback.message, user_id)

    await callback.answer("🎉 Молодец!")

@dp.callback_query(F.data == "back_to_bingo")
async def back_to_bingo(callback: CallbackQuery):
    user_id = callback.from_user.id
    await send_bingo_card(callback.message, user_id)
    await callback.answer()

@dp.callback_query(F.data == "regen_card")
async def regen_card(callback: CallbackQuery):
    user_id = callback.from_user.id
    week = get_user_week(user_id)

    if get_completed_cells(user_id, week):
        await callback.answer("Нельзя перегенерировать карту, если уже что-то отмечено — прогресс потеряется.", show_alert=True)
        return

    increment_card_regens(user_id)
    scores = get_user_scores(user_id)
    new_card = await build_weekly_card(user_id, scores, week)
    save_bingo_card(user_id, new_card)

    await callback.answer("🔄 Новая карта готова!")
    await send_bingo_card(callback.message, user_id)

# ==================== DAILY REMINDERS ====================
async def send_daily_reminders():
    """Runs every hour; only messages users whose chosen reminder_hour matches
    the current server hour (see /remind)."""
    current_hour = datetime.now().hour
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT user_id FROM users WHERE COALESCE(reminder_hour, 9) = ?", (current_hour,))
    users = c.fetchall()
    conn.close()

    for (user_id,) in users:
        try:
            week = get_user_week(user_id)
            completed = get_completed_cells(user_id, week)
            card = get_bingo_card(user_id)
            if not card:
                card = await build_weekly_card(user_id, get_user_scores(user_id), week)
                save_bingo_card(user_id, card)
            if len(completed) < len(card):
                streak = get_streak(user_id)
                streak_line = f"\n🔥 Стрик: {streak}" if streak else ""
                await bot.send_message(
                    user_id,
                    "🌅 <b>Доброе утро!</b>\n\n"
                    "Новый день — новая возможность зачеркнуть клетку в бинго."
                    f"{streak_line}\n\nКакое задание выберешь сегодня?",
                    parse_mode="HTML",
                    reply_markup=build_bingo_keyboard(list(card.keys()), completed)
                )
        except Exception as e:
            print(f"Failed to send reminder to {user_id}: {e}")

async def send_evening_reminders():
    """Runs every hour; only messages users whose chosen evening_reminder_hour
    matches the current server hour (see /evening). Shows what got done today,
    without judgment if nothing did."""
    current_hour = datetime.now().hour
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT user_id FROM users WHERE COALESCE(evening_reminder_hour, 20) = ?", (current_hour,))
    users = c.fetchall()
    conn.close()

    for (user_id,) in users:
        try:
            week = get_user_week(user_id)
            card = get_bingo_card(user_id)
            if not card:
                continue  # ещё не проходил опрос — вечернее напоминание ему рано

            today_cells = get_completed_today(user_id)

            if today_cells:
                lines = [f"🌙 <b>Как прошёл день?</b>\n\nСегодня отмечено:"]
                for key in today_cells:
                    label = KEY_TO_LABEL.get(key, key)
                    lines.append(f"✅ {label}")
                completed = get_completed_cells(user_id, week)
                lines.append(f"\nВсего на неделе: {len(completed)}/{len(card)}")
                text = "\n".join(lines)
            else:
                text = (
                    "🌙 <b>Как прошёл день?</b>\n\n"
                    "Сегодня пока ничего не отмечено — вечер ещё не кончился, если что-то откликается, самое время."
                )

            await bot.send_message(user_id, text, parse_mode="HTML")
        except Exception as e:
            print(f"Failed to send evening reminder to {user_id}: {e}")

@dp.message(Command("remind"))
async def set_reminder_time(message: Message):
    parts = message.text.split()
    if len(parts) != 2 or not parts[1].isdigit() or not (0 <= int(parts[1]) <= 23):
        await message.answer("Укажи час в формате: <code>/remind 9</code> (0–23, время сервера бота).", parse_mode="HTML")
        return

    hour = int(parts[1])
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET reminder_hour = ? WHERE user_id = ?", (hour, message.from_user.id))
    conn.commit()
    conn.close()
    await message.answer(f"Готово! Буду напоминать утром в {hour}:00 (время сервера).")

@dp.message(Command("evening"))
async def set_evening_reminder_time(message: Message):
    parts = message.text.split()
    if len(parts) != 2 or not parts[1].isdigit() or not (0 <= int(parts[1]) <= 23):
        await message.answer("Укажи час в формате: <code>/evening 20</code> (0–23, время сервера бота).", parse_mode="HTML")
        return

    hour = int(parts[1])
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET evening_reminder_hour = ? WHERE user_id = ?", (hour, message.from_user.id))
    conn.commit()
    conn.close()
    await message.answer(f"Готово! Буду спрашивать про день в {hour}:00 (время сервера).")

# ==================== ADMIN COMMANDS ====================
@dp.message(Command("stats"), F.from_user.id == ADMIN_ID)
async def admin_stats(message: Message):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    users_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM completed_tasks")
    tasks_count = c.fetchone()[0]
    c.execute("SELECT AVG(current_week) FROM users")
    avg_week = c.fetchone()[0] or 1
    c.execute("SELECT AVG(streak_days) FROM users")
    avg_streak = c.fetchone()[0] or 0
    conn.close()

    await message.answer(
        f"📊 <b>Статистика</b>\n\n"
        f"Пользователей: {users_count}\n"
        f"Выполнено заданий: {tasks_count}\n"
        f"Средняя неделя: {avg_week:.1f}\n"
        f"Средний стрик: {avg_streak:.1f} дней",
        parse_mode="HTML"
    )

# ==================== MAIN ====================
async def main():
    await bot.set_my_commands([
        BotCommand(command="start", description="🚀 Начать / открыть мою карту"),
        BotCommand(command="remind", description="⏰ Настроить утреннее напоминание"),
        BotCommand(command="evening", description="🌙 Настроить вечернее напоминание"),
    ])

    scheduler.add_job(send_daily_reminders, "cron", minute=0)
    scheduler.add_job(send_evening_reminders, "cron", minute=0)
    scheduler.start()

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

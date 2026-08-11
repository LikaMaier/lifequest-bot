# ============================================================
# LIFQUEST BOT — Telegram Bot Template (aiogram 3.x)
# Версия с Groq API (бесплатный tier, без VPN)
# ============================================================

import asyncio
import json
import os
import sqlite3
from datetime import datetime, timedelta

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, 
    InlineKeyboardButton, ReplyKeyboardRemove, ContentType,
    InputMediaPhoto
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
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            photo_file_id TEXT,
            notes TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS life_map_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            photo_file_id TEXT,
            task_cell TEXT,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migrations for bots created before these features existed.
    _ensure_column(c, "users", "last_active_date", "TEXT")
    _ensure_column(c, "users", "reminder_hour", "INTEGER DEFAULT 9")
    _ensure_column(c, "users", "scores", "TEXT")
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
    c.execute("UPDATE users SET current_week = COALESCE(current_week, 1) + 1 WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()

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

def save_completed_task(user_id: int, cell: str, text: str, photo_id: str = None, notes: str = None, week: int = None):
    if week is None:
        week = get_user_week(user_id)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO completed_tasks (user_id, task_cell, task_text, photo_file_id, notes, week)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (user_id, cell, text, photo_id, notes, week))
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

def save_life_map_photo(user_id: int, photo_id: str, cell: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO life_map_photos (user_id, photo_file_id, task_cell) VALUES (?, ?, ?)",
              (user_id, photo_id, cell))
    conn.commit()
    conn.close()

def get_life_map_photos(user_id: int) -> list:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT photo_file_id FROM life_map_photos WHERE user_id = ? ORDER BY uploaded_at", (user_id,))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows]

def get_diary_entries(user_id: int, limit: int = 10) -> list:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT notes, completed_at FROM completed_tasks
        WHERE user_id = ? AND task_cell = 'diary' AND notes IS NOT NULL
        ORDER BY completed_at DESC LIMIT ?
    """, (user_id, limit))
    rows = c.fetchall()
    conn.close()
    return list(reversed(rows))

# ==================== SURVEY DATA ====================
SURVEY_QUESTIONS = [
    {"id": "q1", "sphere": "❤️ Социальность", "question": "Как часто ты знакомишься с новыми людьми?",
     "options": [("Никогда. Мне комфортно в своём кругу.", 1), ("Раз в несколько месяцев. Случайно, неохотно.", 2),
                 ("Иногда. Когда обстоятельства складываются.", 3), ("Часто. Мне нравится открывать людей.", 4)]},
    {"id": "q2", "sphere": "❤️ Социальность", "question": "Какой вариант тебе ближе?",
     "options": [("Хочу больше знакомств, но не знаю как начать.", 1), ("Хочу глубже общаться с теми, кто уже рядом.", 2),
                 ("Мне комфортно как есть. Не хочу ничего менять.", 3), ("Хочу и новых людей, и глубины в старых связях.", 4)]},
    {"id": "q3", "sphere": "❤️ Социальность", "question": "Что чаще всего тебя останавливает в общении?",
     "options": [("Не знаю, как начать разговор. Замираю.", 1), ("Боюсь показаться навязчивым или глупым.", 2),
                 ("Не люблю большие компании. Теряюсь в них.", 3), ("Просто редко появляются возможности. Не ищу.", 4)]},
    {"id": "q4", "sphere": "🌍 Приключения", "question": "Сколько раз за последний месяц ты делал что-то впервые?",
     "options": [("Ни разу. Всё по накатанной.", 1), ("1–2 раза. Случайно, не специально.", 2),
                 ("Несколько раз. Иногда ловлю себя на новом.", 3), ("Постоянно. Ищу новое и цепляюсь за него.", 4)]},
    {"id": "q5", "sphere": "🌍 Приключения", "question": "Что тебе сейчас хочется?",
     "options": [("Больше путешествий. Даже маленьких.", 1), ("Больше спонтанности. Чтобы жизнь удивляла.", 2),
                 ("Больше ярких эмоций. Чтобы сердце билось чаще.", 3), ("Больше красивых мест. Чтобы мир казался шире.", 4)]},
    {"id": "q6", "sphere": "🌍 Приключения", "question": "Что мешает тебе вырваться из рутины?",
     "options": [("Деньги. Хочу, но не могу позволить.", 1), ("Время. Работа/учёба съедает всё.", 2),
                 ("Страшно одному. А с кем — непонятно.", 3), ("Не приходят идеи. Не знаю, что попробовать.", 4)]},
    {"id": "q7", "sphere": "💪 Смелость", "question": "Когда появляется возможность попробовать что-то новое...",
     "options": [("Почти всегда отказываюсь. Нахожу отговорку.", 1), ("Думаю слишком долго. Пока думаю — момент уходит.", 2),
                 ("Иногда соглашаюсь. Если настроение правильное.", 3), ("Обычно пробую. Лучше пожалеть о попытке, чем о молчании.", 4)]},
    {"id": "q8", "sphere": "💪 Смелость", "question": "Где хотелось бы стать смелее?",
     "options": [("В общении. Сказать то, что думаю. Начать разговор.", 1), ("В работе/учёбе. Попросить повышения. Сказать «нет».", 2),
                 ("В отношениях. Открыться. Показать уязвимость.", 3), ("В самовыражении. Показать миру, кто я есть.", 4)]},
    {"id": "q9", "sphere": "💪 Смелость", "question": "Что пугает сильнее всего?",
     "options": [("Ошибиться. И потом жить с этим.", 1), ("Получить отказ. Быть отвергнутым.", 2),
                 ("Выглядеть глупо. Что подумают другие.", 3), ("Потратить время впустую. А вдруг не стоило?", 4)]},
    {"id": "q10", "sphere": "🧠 Саморазвитие", "question": "Что чаще происходит с твоими начинаниями?",
     "options": [("Начинаю и бросаю. Снова. И снова. Устал от этого.", 1), ("Постоянно откладываю. «Начну с понедельника».", 2),
                 ("Учусь понемногу. Медленно, но не бросаю.", 3), ("Регулярно развиваюсь. Нашёл свой ритм.", 4)]},
    {"id": "q11", "sphere": "🧠 Саморазвитие", "question": "Чему давно хочется научиться, но руки не доходят?",
     "options": [("Чему-то творческому. Рисовать, писать, музыка, фото.", 1), ("Физическому. Танцы, спорт, йога, вёрстка.", 2),
                 ("Интеллектуальному. Язык, программирование, наука.", 3), ("Ничему конкретному. Не знаю, что меня зажжёт.", 4)]},
    {"id": "q12", "sphere": "🧠 Саморазвитие", "question": "Что обычно мешает?",
     "options": [("Нет времени. Жизнь съедает всё.", 1), ("Нет дисциплины. Не могу заставить себя.", 2),
                 ("Не знаю, с чего начать. Паралич выбора.", 3), ("Быстро теряю интерес. Зажигаюсь и гасну.", 4)]},
    {"id": "q13", "sphere": "⚡ Энергия", "question": "Что сейчас чаще всего?",
     "options": [("Скука. Дни сливаются в одно серое пятно.", 1), ("Усталость. Даже отдых не восстанавливает.", 2),
                 ("Тревога. Мысли крутятся, не дают покоя.", 3), ("Рутина. Всё по расписанию, но без души.", 4)]},
    {"id": "q14", "sphere": "⚡ Энергия", "question": "Чего не хватает?",
     "options": [("Азарта. Чтобы хотелось просыпаться утром.", 1), ("Спокойствия. Чтобы голова внутри затихла.", 2),
                 ("Вдохновения. Чтобы глаза снова горели.", 3), ("Радости. Чтобы было за что улыбаться.", 4)]},
    {"id": "q15", "sphere": "⚡ Энергия", "question": "После какого дня ты обычно чувствуешь себя живым?",
     "options": [("После общения. Когда по-настоящему поговорил.", 1), ("После спорта. Когда тело напомнило, что оно есть.", 2),
                 ("После путешествия. Даже маленького. Даже в соседний район.", 3), ("После творчества. Когда создал что-то своё руками.", 4),
                 ("После спокойного отдыха. Когда никто не трогал.", 5)]},
    {"id": "q16", "sphere": "📋 Дисциплина", "question": "Как ты относишься к обещаниям, которые даёшь самому себе?",
     "options": [("Не верю себе. Уже столько раз обещал и не сделал.", 1), ("Слабо доверяю. Иногда получается, чаще — нет.", 2),
                 ("Умеренно. Стараюсь, но бывают провалы.", 3), ("Полностью доверяю. Если сказал — сделаю.", 4)]},
    {"id": "q17", "sphere": "📋 Дисциплина", "question": "Сколько у тебя «висящих» дел, которые давно надо закрыть?",
     "options": [("Гора. Давно перестал считать. Тревожит.", 1), ("Несколько штук. Висят, но не мешают сильно.", 2),
                 ("Почти всё сделано. Немного осталось.", 3), ("Всё под контролем. Голова чистая.", 4)]},
    {"id": "q18", "sphere": "📋 Дисциплина", "question": "Как ты обычно начинаешь утро?",
     "options": [("В телефон. Листаю ленту, не замечая, как проходит час.", 1), ("В спешке. Опоздал, всё на бегу, нет времени подумать.", 2),
                 ("По привычке. Кофе, душ, работа. Автопилот.", 3), ("Осознанно. Есть ритуал, который заряжает.", 4)]},
    {"id": "q19", "sphere": "🎨 Творчество", "question": "Когда последний раз ты делал что-то руками, не для работы?",
     "options": [("Не помню. Всё кажется бессмысленным.", 1), ("Месяц назад. Было приятно, но не повторял.", 2),
                 ("Неделю назад. Иногда тянет, но редко.", 3), ("Недавно. Творчество — мой способ дышать.", 4)]},
    {"id": "q20", "sphere": "🎨 Творчество", "question": "Есть ли у тебя способ выразить себя, когда слов не хватает?",
     "options": [("Нет. Не знаю, как выразить то, что внутри.", 1), ("Было, но забросил. Давно не возвращался.", 2),
                 ("Есть, но редко. Когда настроение особенное.", 3), ("Да. Это часть меня. Не могу без этого.", 4)]},
    {"id": "q21", "sphere": "🎨 Творчество", "question": "Как ты относишься к выходу из зоны комфорта?",
     "options": [("Боюсь. Зона комфорта — моя крепость. Там безопасно.", 1), ("Неохотно. Но понимаю, что без этого — тупик.", 2),
                 ("Стараюсь. Шаг за шагом. Не всегда получается.", 3), ("Люблю. Там, где страшно — там и рост.", 4)]},
]

# ==================== FSM STATES ====================
class SurveyStates(StatesGroup):
    q1 = State(); q2 = State(); q3 = State(); q4 = State(); q5 = State()
    q6 = State(); q7 = State(); q8 = State(); q9 = State(); q10 = State()
    q11 = State(); q12 = State(); q13 = State(); q14 = State(); q15 = State()
    q16 = State(); q17 = State(); q18 = State(); q19 = State(); q20 = State()
    q21 = State(); analyzing = State()

STATE_MAP = {
    SurveyStates.q1: 0, SurveyStates.q2: 1, SurveyStates.q3: 2,
    SurveyStates.q4: 3, SurveyStates.q5: 4, SurveyStates.q6: 5,
    SurveyStates.q7: 6, SurveyStates.q8: 7, SurveyStates.q9: 8,
    SurveyStates.q10: 9, SurveyStates.q11: 10, SurveyStates.q12: 11,
    SurveyStates.q13: 12, SurveyStates.q14: 13, SurveyStates.q15: 14,
    SurveyStates.q16: 15, SurveyStates.q17: 16, SurveyStates.q18: 17,
    SurveyStates.q19: 18, SurveyStates.q20: 19, SurveyStates.q21: 20,
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
BINGO_CELLS = [
    ("🌅 Утро", "Утро", "cell_morning"),
    ("📋 План", "План", "cell_plan"),
    ("💪 Движение", "Движение", "cell_move"),
    ("🌍 Приключение", "Приключение", "cell_adventure1"),
    ("🐸 ЛЯГУШКА", "ЛЯГУШКА", "cell_frog"),
    ("🎲 Рандом", "Рандом", "cell_random"),
    ("😨 Страх", "Страх", "cell_fear"),
    ("🔥 Испытание", "Испытание", "cell_challenge"),
    ("✨ Проявление", "Проявление", "cell_expression"),
]

def build_bingo_keyboard(completed: list) -> InlineKeyboardMarkup:
    buttons = []
    row = []
    for i, (text, _plain, data) in enumerate(BINGO_CELLS):
        prefix = "✅ " if data in completed else ""
        row.append(InlineKeyboardButton(text=f"{prefix}{text}", callback_data=f"bingo_{data}"))
        if (i + 1) % 3 == 0:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton(text="📸 Отправить фото на карту жизни", callback_data="upload_photo")])
    buttons.append([InlineKeyboardButton(text="📝 Запись в дневник", callback_data="diary_entry")])
    buttons.append([InlineKeyboardButton(text="🗺 Моя карта жизни", callback_data="view_map")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)

# ==================== WELCOME ====================
WELCOME_TEXT = """🗺️ <b>Добро пожаловать в LifeQuest</b>

Твоя жизнь — приключение. Даже если сейчас это не очевидно.

<b>🎯 Миссия бота</b>
Помочь тебе выбраться из застоя, когда жизнь кажется серой и пустой. Мы превращаем рутину в игру, а маленькие победы — в топливо для веры в себя.

<b>Как работает:</b>
1️⃣ Диагностика — 21 вопрос о 7 сферах жизни
2️⃣ Персональная бинго-карта на неделю
3️⃣ Выполняй и отмечай в дневнике
4️⃣ Набирай победы — каждая клетка = шаг к наполненной жизни

<i>Займёт ~5 минут. Всё анонимно. Начнём с понимания, где ты сейчас.</i>"""

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
        [InlineKeyboardButton(text="🚀 Начать опрос (21 вопрос)", callback_data="start_survey")]
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
BINGO_TEMPLATE = {
    "morning": """🌅 <b>Утро</b>
Первые 30 минут после пробуждения — без телефона. Сделай 5 глубоких вдохов. Выпей воды. Напиши 1 мысль, которая пришла в голову.""",
    "plan": """📋 <b>План</b>
Выпиши 1 долгосрочную цель, на которой хочешь сконцентрироваться. Разбей на 3 шага на эту неделю. Запиши в дневник.""",
    "move": """💪 <b>Движение</b>
15 минут растяжки или прогулка без цели. Или танцуй под 3 любимые песни. Движение как медитация.""",
    "adventure1": """🌍 <b>Приключение</b>
Дойди до незнакомого места в радиусе 3 км. Посиди там 15 мин без телефона. Наблюдай. Запиши 1 новое наблюдение.""",
    "frog": """🐸 <b>ЛЯГУШКА</b>
Закрой самое тяжёлое висящее дело, которое тревожит больше недели. Сделай это первым делом в один из дней. Не откладывай.""",
    "random": """🎲 <b>Рандом</b>
Выйди на улицу и попроси прохожего назвать самое красивое место поблизости. Дойди туда. Сделай 1 фото. Запиши, что он сказал.""",
    "fear": """😨 <b>Страх</b>
Сделай то, что давно боишься: звонок важному человеку, признание, первый шаг к цели. Не ищи идеального момента — просто начни.""",
    "challenge": """🔥 <b>Испытание</b>
Согласись на то, что обычно отклонил бы. Или скажи «да» спонтанному предложению. Даже если неуверен. Запиши, что произошло.""",
    "expression": """✨ <b>Проявление</b>
Создай что-то руками: нарисуй, напиши 10 строк стиха, сделай коллаж, запиши голосовое послание себе. Не для кого. Для себя. Зафиксируй в дневнике.""",
}

# Each cell is tied to one of the 7 survey spheres. A low score in that sphere
# gets the gentler "low" task (build the habit); a high score gets the more
# ambitious "high" task (same text as BINGO_TEMPLATE, for continuity/fallback).
BINGO_VARIANTS = {
    "morning": {
        "sphere": "Энергия",
        "high": BINGO_TEMPLATE["morning"],
        "low": """🌅 <b>Утро</b>
Просто не хватайся за телефон первые 5 минут после будильника. Выпей стакан воды. Это всё — этого достаточно на сегодня.""",
    },
    "plan": {
        "sphere": "Саморазвитие",
        "high": BINGO_TEMPLATE["plan"],
        "low": """📋 <b>План</b>
Выпиши всего 1 маленькое дело, которое сделаешь сегодня. Не список — одно. Сделай его и отметь клетку.""",
    },
    "move": {
        "sphere": "Энергия",
        "high": BINGO_TEMPLATE["move"],
        "low": """💪 <b>Движение</b>
Пройдись 10 минут пешком в удобном темпе. Без цели, без спорта — просто прогуляйся.""",
    },
    "adventure1": {
        "sphere": "Приключения",
        "high": BINGO_TEMPLATE["adventure1"],
        "low": """🌍 <b>Приключение</b>
Выбери маршрут до работы или магазина, которым никогда не ходил. Просто пройди и замечай, что там другое.""",
    },
    "frog": {
        "sphere": "Дисциплина",
        "high": BINGO_TEMPLATE["frog"],
        "low": """🐸 <b>ЛЯГУШКА</b>
Выбери одно небольшое дело, которое откладываешь больше недели, и закрой его — неважно, насколько оно маленькое.""",
    },
    "random": {
        "sphere": "Социальность",
        "high": BINGO_TEMPLATE["random"],
        "low": """🎲 <b>Рандом</b>
Напиши короткое сообщение человеку, с которым давно не общался. Просто спроси, как у него дела.""",
    },
    "fear": {
        "sphere": "Смелость",
        "high": BINGO_TEMPLATE["fear"],
        "low": """😨 <b>Страх</b>
Назови вслух или запиши одну вещь, которую боишься сделать. Не делай — просто признай это себе. Это уже шаг.""",
    },
    "challenge": {
        "sphere": "Смелость",
        "high": BINGO_TEMPLATE["challenge"],
        "low": """🔥 <b>Испытание</b>
Попробуй сегодня блюдо, музыку или фильм, которые обычно не выбрал бы. Маленький эксперимент — не подвиг.""",
    },
    "expression": {
        "sphere": "Творчество",
        "high": BINGO_TEMPLATE["expression"],
        "low": """✨ <b>Проявление</b>
Сделай одну маленькую творческую штуку: пару строк, набросок, голосовую заметку. Не для качества — для процесса.""",
    },
}

def build_personal_bingo(scores: dict, week: int = 1) -> dict:
    """Picks low/high variant per cell from the sphere score. Each completed
    week nudges everyone toward the more ambitious variant, so the card
    visibly gets bolder over time even without a fresh LLM call."""
    boost = max(0, week - 1) * 20
    card = {}
    for key, info in BINGO_VARIANTS.items():
        sphere_score = (scores.get(info["sphere"], 50) if scores else 50) + boost
        card[key] = info["high"] if sphere_score >= 50 else info["low"]
    return card

async def generate_and_send_profile(message, user_id: int):
    answers = get_all_answers(user_id)
    answers_json = json.dumps(answers, ensure_ascii=False)

    prompt = f"""Ты — LifeQuest бот. Пользователь прошёл опрос из 21 вопроса.
Вот его ответы (1-4 шкала, где 1 = минимум, 4 = максимум):
{answers_json}

Создай:
1. Психологический профиль — 1 тёплый абзац (2-3 предложения). Не диагноз, а наблюдение. Укажи одну особенность, которую заметил. Объясни, почему именно такие задания подойдут.
2. Бар-чарт по 7 сферам в процентах (0-100%). Сферы: Социальность, Приключения, Смелость, Саморазвитие, Энергия, Дисциплина, Творчество.

Верни ТОЛЬКО JSON в таком формате:
{{"profile_text": "...", "scores": {{"Социальность": 58, "Приключения": 83, ...}}}}"""

    try:
        # Используем Groq API (Llama 3 70B — бесплатный tier)
        response = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",  # или "mixtral-8x7b-32768" для ещё большей скорости
            messages=[
                {"role": "system", "content": "Ты — тёплый, психологически грамотный бот. Пишешь на русском. Не используешь ярлыки."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=800
        )

        content = response.choices[0].message.content
        # Извлекаем JSON из ответа
        json_start = content.find("{")
        json_end = content.rfind("}") + 1
        result = json.loads(content[json_start:json_end])

        profile_text = result.get("profile_text", "Профиль создан.")
        scores = result.get("scores", {})

        # Формируем текст профиля
        scores_text = "\n".join([
            f"{k} {'█' * int(v/10)}{'░' * (10-int(v/10))} {v}%"
            for k, v in scores.items()
        ])

        full_profile = f"""🎯 <b>Твой профиль</b>

{profile_text}

📊 <b>Сферы:</b>
<pre>{scores_text}</pre>

<i>Теперь — твоя бинго-карта на неделю. Выполняй в любом порядке. Зачеркивай клетки.</i>"""

        week = get_user_week(user_id)
        personal_card = build_personal_bingo(scores, week)
        save_user_profile(user_id, profile_text, json.dumps(scores, ensure_ascii=False), json.dumps(personal_card, ensure_ascii=False))

        await message.edit_text(full_profile, parse_mode="HTML")

        # Отправляем бинго-карту отдельным сообщением
        await send_bingo_card(message, user_id)

    except Exception as e:
        print(f"Error generating profile: {e}")
        # Fallback — отправляем шаблонную карту (без персонализации по баллам)
        week = get_user_week(user_id)
        personal_card = build_personal_bingo({}, week)
        save_user_profile(
            user_id,
            "Я заметил одну особенность: ты хочешь ярких впечатлений, но между желанием и действием стоит страх ошибки. "
            "Поэтому задания подобраны так, чтобы начать с малого и постепенно расширить твою зону возможностей.",
            json.dumps({}),
            json.dumps(personal_card, ensure_ascii=False)
        )
        await message.edit_text(
            "🎯 <b>Твой профиль</b>\n\n"
            "Я заметил одну особенность: ты хочешь ярких впечатлений, но между желанием и действием стоит страх ошибки. "
            "Поэтому задания подобраны так, чтобы начать с малого и постепенно расширить твою зону возможностей.\n\n"
            "🎲 <b>Твоя бинго-карта на неделю:</b>",
            parse_mode="HTML"
        )
        await send_bingo_card(message, user_id)

async def send_bingo_card(message, user_id: int):
    week = get_user_week(user_id)
    completed = get_completed_cells(user_id, week)
    streak = get_streak(user_id)
    card = get_bingo_card(user_id)

    header = f"🎲 <b>Бинго-карта — неделя {week}</b> ({len(completed)}/9)"
    if streak:
        header += f"  🔥 {streak}"

    lines = [header]
    for _emoji_label, _plain_label, data in BINGO_CELLS:
        key = data.replace("cell_", "")
        task_text = card.get(key) or BINGO_TEMPLATE.get(key, "")
        prefix = "✅ " if data in completed else ""
        lines.append(f"{prefix}{task_text}")
    lines.append("Нажми на клетку, чтобы отметить выполнение 👇")

    await message.answer(
        "\n\n".join(lines),
        parse_mode="HTML",
        reply_markup=build_bingo_keyboard(completed)
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
    task_text = card.get(cell) or BINGO_TEMPLATE.get(cell, "Задание")

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Выполнено!", callback_data=f"complete_{cell}")],
        [InlineKeyboardButton(text="📸 Прикрепить фото", callback_data=f"photo_{cell}")],
        [InlineKeyboardButton(text="« Назад к карте", callback_data="back_to_bingo")]
    ])

    await callback.message.edit_text(task_text, parse_mode="HTML", reply_markup=kb)
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
    task_text = card.get(cell) or BINGO_TEMPLATE.get(cell, "Задание")

    save_completed_task(user_id, cell, task_text, week=week)
    touch_activity(user_id)

    completed = get_completed_cells(user_id, week)

    if len(completed) >= len(BINGO_CELLS):
        streak = get_streak(user_id)
        await callback.message.edit_text(
            f"🏆 <b>Неделя {week} закрыта!</b>\n\n"
            f"Все 9 клеток пройдены. Стрик: {streak} 🔥\n\n"
            "Собираю карту на следующую неделю — она станет чуть смелее...",
            parse_mode="HTML"
        )
        advance_week(user_id)
        new_week = get_user_week(user_id)
        scores = get_user_scores(user_id)
        new_card = build_personal_bingo(scores, new_week)
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

# ==================== LIFE MAP ====================
@dp.callback_query(F.data == "view_map")
async def view_life_map(callback: CallbackQuery):
    user_id = callback.from_user.id
    await callback.answer()

    photos = get_life_map_photos(user_id)
    diary_rows = get_diary_entries(user_id, limit=10)

    if not photos and not diary_rows:
        await callback.message.answer(
            "🗺 <b>Карта твоей жизни пока пуста.</b>\n\n"
            "Добавь фото или запись в дневник кнопками ниже — и она начнёт заполняться.",
            parse_mode="HTML"
        )
        return

    if photos:
        for i in range(0, len(photos), 10):
            chunk = photos[i:i + 10]
            media = [InputMediaPhoto(media=file_id) for file_id in chunk]
            await callback.message.answer_media_group(media)

    if diary_rows:
        entries = []
        for notes, completed_at in diary_rows:
            date_str = (completed_at or "")[:10]
            entries.append(f"<b>{date_str}</b>\n{notes}")
        diary_text = "📝 <b>Последние записи в дневнике</b>\n\n" + "\n\n".join(entries)
        if len(diary_text) > 4000:
            diary_text = diary_text[:4000] + "…"
        await callback.message.answer(diary_text, parse_mode="HTML")

# ==================== PHOTO UPLOAD ====================
@dp.callback_query(F.data == "upload_photo")
async def request_general_photo(callback: CallbackQuery, state: FSMContext):
    await state.update_data(photo_cell="general")
    await state.set_state("waiting_photo")

    await callback.message.edit_text(
        "📸 <b>Отправь фото</b>\n\n"
        "Пришли снимок, который хочешь добавить на карту твоей жизни.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="« Отмена", callback_data="back_to_bingo")]
        ])
    )
    await callback.answer()

@dp.callback_query(F.data.startswith("photo_"))
async def request_photo(callback: CallbackQuery, state: FSMContext):
    cell = callback.data.replace("photo_", "")
    await state.update_data(photo_cell=cell)
    await state.set_state("waiting_photo")

    await callback.message.edit_text(
        "📸 <b>Отправь фото</b>\n\n"
        "Сделай снимок, связанный с этим заданием. Я добавлю его на твою карту жизни.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="« Отмена", callback_data="back_to_bingo")]
        ])
    )
    await callback.answer()

@dp.message(F.content_type == ContentType.PHOTO, State("waiting_photo"))
async def handle_photo(message: Message, state: FSMContext):
    data = await state.get_data()
    cell = data.get("photo_cell", "unknown")
    user_id = message.from_user.id

    photo_id = message.photo[-1].file_id
    save_life_map_photo(user_id, photo_id, cell)
    touch_activity(user_id)

    await message.answer("📸 Фото добавлено на карту твоей жизни!")
    await send_bingo_card(message, user_id)
    await state.clear()

# ==================== DIARY ====================
@dp.callback_query(F.data == "diary_entry")
async def diary_entry(callback: CallbackQuery, state: FSMContext):
    await state.set_state("waiting_diary")
    await callback.message.edit_text(
        "📝 <b>Запись в дневник</b>\n\n"
        "Напиши, что ты сделал сегодня, какие эмоции испытал, что узнал о себе.\n\n"
        "Это твой личный архив побед.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="« Назад", callback_data="back_to_bingo")]
        ])
    )
    await callback.answer()

@dp.message(State("waiting_diary"))
async def save_diary(message: Message, state: FSMContext):
    text = message.text
    user_id = message.from_user.id

    save_completed_task(user_id, "diary", "Дневниковая запись", notes=text)
    touch_activity(user_id)

    await message.answer("📝 Запись сохранена! Твой дневник растёт.")

    await send_bingo_card(message, user_id)
    await state.clear()

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
            if len(completed) < len(BINGO_CELLS):
                streak = get_streak(user_id)
                streak_line = f"\n🔥 Стрик: {streak}" if streak else ""
                await bot.send_message(
                    user_id,
                    "🌅 <b>Доброе утро!</b>\n\n"
                    "Новый день — новая возможность зачеркнуть клетку в бинго."
                    f"{streak_line}\n\nКакое задание выберешь сегодня?",
                    parse_mode="HTML",
                    reply_markup=build_bingo_keyboard(completed)
                )
        except Exception as e:
            print(f"Failed to send reminder to {user_id}: {e}")

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
    await message.answer(f"Готово! Буду напоминать в {hour}:00 (время сервера).")

# ==================== ADMIN COMMANDS ====================
@dp.message(Command("stats"), F.from_user.id == ADMIN_ID)
async def admin_stats(message: Message):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    users_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM completed_tasks")
    tasks_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM life_map_photos")
    photos_count = c.fetchone()[0]
    c.execute("SELECT AVG(current_week) FROM users")
    avg_week = c.fetchone()[0] or 1
    c.execute("SELECT AVG(streak_days) FROM users")
    avg_streak = c.fetchone()[0] or 0
    conn.close()

    await message.answer(
        f"📊 <b>Статистика</b>\n\n"
        f"Пользователей: {users_count}\n"
        f"Выполнено заданий: {tasks_count}\n"
        f"Фото на карте жизни: {photos_count}\n"
        f"Средняя неделя: {avg_week:.1f}\n"
        f"Средний стрик: {avg_streak:.1f} дней",
        parse_mode="HTML"
    )

# ==================== MAIN ====================
async def main():
    scheduler.add_job(send_daily_reminders, "cron", minute=0)
    scheduler.start()

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

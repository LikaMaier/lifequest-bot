
# ============================================================
# LIFQUEST BOT — Telegram Bot Template (aiogram 3.x)
# ============================================================
# Структура:
# 1. Приветствие + миссия
# 2. Опрос 21 вопрос (FSM — по 1 вопросу за раз)
# 3. Генерация профиля + бинго-карты через OpenAI
# 4. Хранение прогресса (SQLite для простоты, замени на PostgreSQL)
# 5. Приём фото для "карты жизни"
# 6. Ежедневные напоминания
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
    InlineKeyboardButton, ReplyKeyboardRemove, ContentType
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# ==================== CONFIG ====================
BOT_TOKEN = os.getenv("BOT_TOKEN")  # @BotFather
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
client = AsyncOpenAI(api_key=OPENAI_API_KEY)
scheduler = AsyncIOScheduler()

# ==================== DATABASE ====================
DB_PATH = "lifequest.db"

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
    conn.commit()
    conn.close()

init_db()

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

def save_user_profile(user_id: int, profile: str, bingo: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO users (user_id, profile, bingo_card) VALUES (?, ?, ?)",
              (user_id, profile, bingo))
    conn.commit()
    conn.close()

def get_user_profile(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT profile, bingo_card FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row if row else (None, None)

def save_completed_task(user_id: int, cell: str, text: str, photo_id: str = None, notes: str = None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO completed_tasks (user_id, task_cell, task_text, photo_file_id, notes)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, cell, text, photo_id, notes))
    conn.commit()
    conn.close()

def get_completed_cells(user_id: int) -> list:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT DISTINCT task_cell FROM completed_tasks WHERE user_id = ?", (user_id,))
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

# ==================== SURVEY DATA ====================
# 7 сфер × 3 вопроса = 21 вопрос
SURVEY_QUESTIONS = [
    # === СОЦИАЛЬНОСТЬ ===
    {
        "id": "q1",
        "sphere": "❤️ Социальность",
        "question": "Как часто ты знакомишься с новыми людьми?",
        "options": [
            ("Никогда. Мне комфортно в своём кругу.", 1),
            ("Раз в несколько месяцев. Случайно, неохотно.", 2),
            ("Иногда. Когда обстоятельства складываются.", 3),
            ("Часто. Мне нравится открывать людей.", 4),
        ]
    },
    {
        "id": "q2",
        "sphere": "❤️ Социальность",
        "question": "Какой вариант тебе ближе?",
        "options": [
            ("Хочу больше знакомств, но не знаю как начать.", 1),
            ("Хочу глубже общаться с теми, кто уже рядом.", 2),
            ("Мне комфортно как есть. Не хочу ничего менять.", 3),
            ("Хочу и новых людей, и глубины в старых связях.", 4),
        ]
    },
    {
        "id": "q3",
        "sphere": "❤️ Социальность",
        "question": "Что чаще всего тебя останавливает в общении?",
        "options": [
            ("Не знаю, как начать разговор. Замираю.", 1),
            ("Боюсь показаться навязчивым или глупым.", 2),
            ("Не люблю большие компании. Теряюсь в них.", 3),
            ("Просто редко появляются возможности. Не ищу.", 4),
        ]
    },
    # === ПРИКЛЮЧЕНИЯ ===
    {
        "id": "q4",
        "sphere": "🌍 Приключения",
        "question": "Сколько раз за последний месяц ты делал что-то впервые?",
        "options": [
            ("Ни разу. Всё по накатанной.", 1),
            ("1–2 раза. Случайно, не специально.", 2),
            ("Несколько раз. Иногда ловлю себя на новом.", 3),
            ("Постоянно. Ищу новое и цепляюсь за него.", 4),
        ]
    },
    {
        "id": "q5",
        "sphere": "🌍 Приключения",
        "question": "Что тебе сейчас хочется?",
        "options": [
            ("Больше путешествий. Даже маленьких.", 1),
            ("Больше спонтанности. Чтобы жизнь удивляла.", 2),
            ("Больше ярких эмоций. Чтобы сердце билось чаще.", 3),
            ("Больше красивых мест. Чтобы мир казался шире.", 4),
        ]
    },
    {
        "id": "q6",
        "sphere": "🌍 Приключения",
        "question": "Что мешает тебе вырваться из рутины?",
        "options": [
            ("Деньги. Хочу, но не могу позволить.", 1),
            ("Время. Работа/учёба съедает всё.", 2),
            ("Страшно одному. А с кем — непонятно.", 3),
            ("Не приходят идеи. Не знаю, что попробовать.", 4),
        ]
    },
    # === СМЕЛОСТЬ ===
    {
        "id": "q7",
        "sphere": "💪 Смелость",
        "question": "Когда появляется возможность попробовать что-то новое...",
        "options": [
            ("Почти всегда отказываюсь. Нахожу отговорку.", 1),
            ("Думаю слишком долго. Пока думаю — момент уходит.", 2),
            ("Иногда соглашаюсь. Если настроение правильное.", 3),
            ("Обычно пробую. Лучше пожалеть о попытке, чем о молчании.", 4),
        ]
    },
    {
        "id": "q8",
        "sphere": "💪 Смелость",
        "question": "Где хотелось бы стать смелее?",
        "options": [
            ("В общении. Сказать то, что думаю. Начать разговор.", 1),
            ("В работе/учёбе. Попросить повышения. Сказать «нет».", 2),
            ("В отношениях. Открыться. Показать уязвимость.", 3),
            ("В самовыражении. Показать миру, кто я есть.", 4),
        ]
    },
    {
        "id": "q9",
        "sphere": "💪 Смелость",
        "question": "Что пугает сильнее всего?",
        "options": [
            ("Ошибиться. И потом жить с этим.", 1),
            ("Получить отказ. Быть отвергнутым.", 2),
            ("Выглядеть глупо. Что подумают другие.", 3),
            ("Потратить время впустую. А вдруг не стоило?", 4),
        ]
    },
    # === САМОРАЗВИТИЕ ===
    {
        "id": "q10",
        "sphere": "🧠 Саморазвитие",
        "question": "Что чаще происходит с твоими начинаниями?",
        "options": [
            ("Начинаю и бросаю. Снова. И снова. Устал от этого.", 1),
            ("Постоянно откладываю. «Начну с понедельника».", 2),
            ("Учусь понемногу. Медленно, но не бросаю.", 3),
            ("Регулярно развиваюсь. Нашёл свой ритм.", 4),
        ]
    },
    {
        "id": "q11",
        "sphere": "🧠 Саморазвитие",
        "question": "Чему давно хочется научиться, но руки не доходят?",
        "options": [
            ("Чему-то творческому. Рисовать, писать, музыка, фото.", 1),
            ("Физическому. Танцы, спорт, йога, вёрстка.", 2),
            ("Интеллектуальному. Язык, программирование, наука.", 3),
            ("Ничему конкретному. Не знаю, что меня зажжёт.", 4),
        ]
    },
    {
        "id": "q12",
        "sphere": "🧠 Саморазвитие",
        "question": "Что обычно мешает?",
        "options": [
            ("Нет времени. Жизнь съедает всё.", 1),
            ("Нет дисциплины. Не могу заставить себя.", 2),
            ("Не знаю, с чего начать. Паралич выбора.", 3),
            ("Быстро теряю интерес. Зажигаюсь и гасну.", 4),
        ]
    },
    # === ЭНЕРГИЯ ===
    {
        "id": "q13",
        "sphere": "⚡ Энергия",
        "question": "Что сейчас чаще всего?",
        "options": [
            ("Скука. Дни сливаются в одно серое пятно.", 1),
            ("Усталость. Даже отдых не восстанавливает.", 2),
            ("Тревога. Мысли крутятся, не дают покоя.", 3),
            ("Рутина. Всё по расписанию, но без души.", 4),
        ]
    },
    {
        "id": "q14",
        "sphere": "⚡ Энергия",
        "question": "Чего не хватает?",
        "options": [
            ("Азарта. Чтобы хотелось просыпаться утром.", 1),
            ("Спокойствия. Чтобы голова внутри затихла.", 2),
            ("Вдохновения. Чтобы глаза снова горели.", 3),
            ("Радости. Чтобы было за что улыбаться.", 4),
        ]
    },
    {
        "id": "q15",
        "sphere": "⚡ Энергия",
        "question": "После какого дня ты обычно чувствуешь себя живым?",
        "options": [
            ("После общения. Когда по-настоящему поговорил.", 1),
            ("После спорта. Когда тело напомнило, что оно есть.", 2),
            ("После путешествия. Даже маленького. Даже в соседний район.", 3),
            ("После творчества. Когда создал что-то своё руками.", 4),
            ("После спокойного отдыха. Когда никто не трогал.", 5),
        ]
    },
    # === ДИСЦИПЛИНА ===
    {
        "id": "q16",
        "sphere": "📋 Дисциплина",
        "question": "Как ты относишься к обещаниям, которые даёшь самому себе?",
        "options": [
            ("Не верю себе. Уже столько раз обещал и не сделал.", 1),
            ("Слабо доверяю. Иногда получается, чаще — нет.", 2),
            ("Умеренно. Стараюсь, но бывают провалы.", 3),
            ("Полностью доверяю. Если сказал — сделаю.", 4),
        ]
    },
    {
        "id": "q17",
        "sphere": "📋 Дисциплина",
        "question": "Сколько у тебя «висящих» дел, которые давно надо закрыть?",
        "options": [
            ("Гора. Давно перестал считать. Тревожит.", 1),
            ("Несколько штук. Висят, но не мешают сильно.", 2),
            ("Почти всё сделано. Немного осталось.", 3),
            ("Всё под контролем. Голова чистая.", 4),
        ]
    },
    {
        "id": "q18",
        "sphere": "📋 Дисциплина",
        "question": "Как ты обычно начинаешь утро?",
        "options": [
            ("В телефон. Листаю ленту, не замечая, как проходит час.", 1),
            ("В спешке. Опоздал, всё на бегу, нет времени подумать.", 2),
            ("По привычке. Кофе, душ, работа. Автопилот.", 3),
            ("Осознанно. Есть ритуал, который заряжает.", 4),
        ]
    },
    # === ТВОРЧЕСТВО ===
    {
        "id": "q19",
        "sphere": "🎨 Творчество",
        "question": "Когда последний раз ты делал что-то руками, не для работы?",
        "options": [
            ("Не помню. Всё кажется бессмысленным.", 1),
            ("Месяц назад. Было приятно, но не повторял.", 2),
            ("Неделю назад. Иногда тянет, но редко.", 3),
            ("Недавно. Творчество — мой способ дышать.", 4),
        ]
    },
    {
        "id": "q20",
        "sphere": "🎨 Творчество",
        "question": "Есть ли у тебя способ выразить себя, когда слов не хватает?",
        "options": [
            ("Нет. Не знаю, как выразить то, что внутри.", 1),
            ("Было, но забросил. Давно не возвращался.", 2),
            ("Есть, но редко. Когда настроение особенное.", 3),
            ("Да. Это часть меня. Не могу без этого.", 4),
        ]
    },
    {
        "id": "q21",
        "sphere": "🎨 Творчество",
        "question": "Как ты относишься к выходу из зоны комфорта?",
        "options": [
            ("Боюсь. Зона комфорта — моя крепость. Там безопасно.", 1),
            ("Неохотно. Но понимаю, что без этого — тупик.", 2),
            ("Стараюсь. Шаг за шагом. Не всегда получается.", 3),
            ("Люблю. Там, где страшно — там и рост.", 4),
        ]
    },
]

# ==================== FSM STATES ====================
class SurveyStates(StatesGroup):
    q1 = State()
    q2 = State()
    q3 = State()
    q4 = State()
    q5 = State()
    q6 = State()
    q7 = State()
    q8 = State()
    q9 = State()
    q10 = State()
    q11 = State()
    q12 = State()
    q13 = State()
    q14 = State()
    q15 = State()
    q16 = State()
    q17 = State()
    q18 = State()
    q19 = State()
    q20 = State()
    q21 = State()
    analyzing = State()

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
def build_question_keyboard(q_id: str, options: list) -> InlineKeyboardMarkup:
    buttons = []
    for text, value in options:
        buttons.append([InlineKeyboardButton(text=text, callback_data=f"{q_id}_{value}")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)

def build_bingo_keyboard(completed: list) -> InlineKeyboardMarkup:
    cells = [
        ("🌅 Утро", "cell_morning"),
        ("📋 План", "cell_plan"),
        ("💪 Движение", "cell_move"),
        ("🌍 Приключение", "cell_adventure1"),
        ("🐸 ЛЯГУШКА", "cell_frog"),
        ("🎲 Рандом", "cell_random"),
        ("😨 Страх", "cell_fear"),
        ("🔥 Испытание", "cell_challenge"),
        ("✨ Проявление", "cell_expression"),
    ]
    buttons = []
    row = []
    for i, (text, data) in enumerate(cells):
        prefix = "✅ " if data in completed else ""
        row.append(InlineKeyboardButton(text=f"{prefix}{text}", callback_data=f"bingo_{data}"))
        if (i + 1) % 3 == 0:
            buttons.append(row)
            row = []
    if row:
        buttons.append(row)
    buttons.append([InlineKeyboardButton(text="📸 Отправить фото на карту жизни", callback_data="upload_photo")])
    buttons.append([InlineKeyboardButton(text="📝 Запись в дневник", callback_data="diary_entry")])
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
        f"🧭 <b>Диагностика: где ты сейчас?</b>

"
        f"<b>{q['sphere']}</b>

"
        f"{q['question']}",
        parse_mode="HTML",
        reply_markup=build_question_keyboard(q["id"], q["options"])
    )

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
        # Все вопросы answered — генерируем профиль
        await state.set_state(SurveyStates.analyzing)
        await callback.message.edit_text(
            "🧠 <b>Анализирую твои ответы...</b>

"
            "Создаю персональный профиль и бинго-карту. Это займёт несколько секунд.",
            parse_mode="HTML"
        )
        await generate_and_send_profile(callback.message, user_id)
        await state.clear()
    else:
        next_q = SURVEY_QUESTIONS[next_idx]
        next_state = list(STATE_MAP.keys())[list(STATE_MAP.values()).index(next_idx)]
        await state.set_state(next_state)

        progress = f"

<i>Вопрос {next_idx + 1} из {len(SURVEY_QUESTIONS)}</i>"
        await callback.message.edit_text(
            f"🧭 <b>Диагностика: где ты сейчас?</b>{progress}

"
            f"<b>{next_q['sphere']}</b>

"
            f"{next_q['question']}",
            parse_mode="HTML",
            reply_markup=build_question_keyboard(next_q["id"], next_q["options"])
        )

    await callback.answer()

# ==================== OPENAI GENERATION ====================
BINGO_TEMPLATE = {
    "morning": "🌅 <b>Утро</b>
Первые 30 минут после пробуждения — без телефона. Сделай 5 глубоких вдохов. Выпей воды. Напиши 1 мысль, которая пришла в голову.",
    "plan": "📋 <b>План</b>
Выпиши 1 долгосрочную цель, на которой хочешь сконцентрироваться. Разбей на 3 шага на эту неделю. Запиши в дневник.",
    "move": "💪 <b>Движение</b>
15 минут растяжки или прогулка без цели. Или танцуй под 3 любимые песни. Движение как медитация.",
    "adventure1": "🌍 <b>Приключение</b>
Дойди до незнакомого места в радиусе 3 км. Посиди там 15 мин без телефона. Наблюдай. Запиши 1 новое наблюдение.",
    "frog": "🐸 <b>ЛЯГУШКА</b>
Закрой самое тяжёлое висящее дело, которое тревожит больше недели. Сделай это первым делом в один из дней. Не откладывай.",
    "random": "🎲 <b>Рандом</b>
Выйди на улицу и попроси прохожего назвать самое красивое место поблизости. Дойди туда. Сделай 1 фото. Запиши, что он сказал.",
    "fear": "😨 <b>Страх</b>
Сделай то, что давно боишься: звонок важному человеку, признание, первый шаг к цели. Не ищи идеального момента — просто начни.",
    "challenge": "🔥 <b>Испытание</b>
Согласись на то, что обычно отклонил бы. Или скажи «да» спонтанному предложению. Даже если неуверен. Запиши, что произошло.",
    "expression": "✨ <b>Проявление</b>
Создай что-то руками: нарисуй, напиши 10 строк стиха, сделай коллаж, запиши голосовое послание себе. Не для кого. Для себя. Зафиксируй в дневнике.",
}

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
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
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
        scores_text = "
".join([
            f"{k} {'█' * int(v/10)}{'░' * (10-int(v/10))} {v}%"
            for k, v in scores.items()
        ])

        full_profile = f"""🎯 <b>Твой профиль</b>

{profile_text}

📊 <b>Сферы:</b>
<pre>{scores_text}</pre>

<i>Теперь — твоя бинго-карта на неделю. Выполняй в любом порядке. Зачеркивай клетки.</i>"""

        save_user_profile(user_id, profile_text, json.dumps(scores))

        await message.edit_text(full_profile, parse_mode="HTML")

        # Отправляем бинго-карту отдельным сообщением
        await send_bingo_card(message, user_id)

    except Exception as e:
        print(f"Error generating profile: {e}")
        # Fallback — отправляем шаблонную карту
        await message.edit_text(
            "🎯 <b>Твой профиль</b>

"
            "Я заметил одну особенность: ты хочешь ярких впечатлений, но между желанием и действием стоит страх ошибки. "
            "Поэтому задания подобраны так, чтобы начать с малого и постепенно расширить твою зону возможностей.

"
            "🎲 <b>Твоя бинго-карта на неделю:</b>",
            parse_mode="HTML"
        )
        await send_bingo_card(message, user_id)

async def send_bingo_card(message, user_id: int):
    completed = get_completed_cells(user_id)

    bingo_text = """🎲 <b>Бинго-карта на неделю</b>

┌─────────┬─────────┬─────────┐
│ 🌅 Утро │ 📋 План │ 💪 Движ │
├─────────┼─────────┼─────────┤
│ 🌍 Прик │ 🐸ЛЯГУШК│ 🎲 Ранд │
├─────────┼─────────┼─────────┤
│ 😨 Страх│ 🔥 Испыт│ ✨ Прояв│
└─────────┴─────────┴─────────┘

Нажми на клетку, чтобы отметить выполнение 👇"""

    await message.answer(bingo_text, parse_mode="HTML", reply_markup=build_bingo_keyboard(completed))

# ==================== BINGO INTERACTION ====================
@dp.callback_query(F.data.startswith("bingo_cell_"))
async def handle_bingo_click(callback: CallbackQuery, state: FSMContext):
    cell = callback.data.replace("bingo_cell_", "")
    user_id = callback.from_user.id

    # Показываем описание задания и кнопку "Выполнено"
    task_text = BINGO_TEMPLATE.get(cell, "Задание")

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
    task_text = BINGO_TEMPLATE.get(cell, "Задание")

    save_completed_task(user_id, cell, task_text)

    completed = get_completed_cells(user_id)

    await callback.message.edit_text(
        f"✅ <b>Клетка выполнена!</b>

{task_text}

"
        f"Отличная работа! Продолжай в том же духе.",
        parse_mode="HTML"
    )

    # Отправляем обновлённую карту
    await callback.message.answer(
        "🎲 <b>Твоя бинго-карта</b>",
        reply_markup=build_bingo_keyboard(completed)
    )
    await callback.answer("🎉 Молодец!")

@dp.callback_query(F.data == "back_to_bingo")
async def back_to_bingo(callback: CallbackQuery):
    user_id = callback.from_user.id
    completed = get_completed_cells(user_id)
    await send_bingo_card(callback.message, user_id)
    await callback.answer()

# ==================== PHOTO UPLOAD ====================
@dp.callback_query(F.data.startswith("photo_"))
async def request_photo(callback: CallbackQuery, state: FSMContext):
    cell = callback.data.replace("photo_", "")
    await state.update_data(photo_cell=cell)
    await state.set_state("waiting_photo")

    await callback.message.edit_text(
        "📸 <b>Отправь фото</b>

"
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

    completed = get_completed_cells(user_id)

    await message.answer("📸 Фото добавлено на карту твоей жизни!")
    await message.answer("🎲 <b>Твоя бинго-карта</b>", reply_markup=build_bingo_keyboard(completed))
    await state.clear()

# ==================== DIARY ====================
@dp.callback_query(F.data == "diary_entry")
async def diary_entry(callback: CallbackQuery, state: FSMContext):
    await state.set_state("waiting_diary")
    await callback.message.edit_text(
        "📝 <b>Запись в дневник</b>

"
        "Напиши, что ты сделал сегодня, какие эмоции испытал, что узнал о себе.

"
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

    await message.answer("📝 Запись сохранена! Твой дневник растёт.")

    completed = get_completed_cells(user_id)
    await message.answer("🎲 <b>Твоя бинго-карта</b>", reply_markup=build_bingo_keyboard(completed))
    await state.clear()

# ==================== DAILY REMINDERS ====================
async def send_daily_reminders():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT user_id FROM users")
    users = c.fetchall()
    conn.close()

    for (user_id,) in users:
        try:
            completed = get_completed_cells(user_id)
            if len(completed) < 9:
                await bot.send_message(
                    user_id,
                    "🌅 <b>Доброе утро!</b>

"
                    "Новый день — новая возможность зачеркнуть клетку в бинго.
"
                    "Какое задание выберешь сегодня?",
                    parse_mode="HTML",
                    reply_markup=build_bingo_keyboard(completed)
                )
        except Exception as e:
            print(f"Failed to send reminder to {user_id}: {e}")

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
    conn.close()

    await message.answer(
        f"📊 <b>Статистика</b>

"
        f"Пользователей: {users_count}
"
        f"Выполнено заданий: {tasks_count}
"
        f"Фото на карте жизни: {photos_count}",
        parse_mode="HTML"
    )

# ==================== MAIN ====================
async def main():
    # Напоминания каждый день в 9:00
    scheduler.add_job(send_daily_reminders, "cron", hour=9, minute=0)
    scheduler.start()

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

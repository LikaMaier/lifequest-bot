# ============================================================
# LIFQUEST BOT — Telegram Bot Template (aiogram 3.x)
# Версия с Groq API через OpenAI-совместимый клиент
# ============================================================

import asyncio
import json
import os
import sqlite3
import io
from datetime import datetime, timedelta

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, 
    InlineKeyboardButton, ReplyKeyboardRemove, ContentType,
    InputFile
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from openai import AsyncOpenAI

# Для генерации изображений
from PIL import Image, ImageDraw, ImageFont

load_dotenv()

# ==================== CONFIG ====================
BOT_TOKEN = os.getenv("BOT_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
client = AsyncOpenAI(api_key=GROQ_API_KEY, base_url="https://api.groq.com/openai/v1")
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
            streak_days INTEGER DEFAULT 0,
            personal_tasks TEXT
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

def save_user_profile(user_id: int, profile: str, bingo: str, tasks: str = None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO users (user_id, profile, bingo_card, personal_tasks) VALUES (?, ?, ?, ?)",
              (user_id, profile, bingo, tasks))
    conn.commit()
    conn.close()

def get_user_profile(user_id: int):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT profile, bingo_card, personal_tasks FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row if row else (None, None, None)

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

# ==================== SURVEY DATA (с короткими кнопками) ====================
SURVEY_QUESTIONS = [
    {"id": "q1", "sphere": "❤️ Социальность", "question": "Как часто ты знакомишься с новыми людьми?",
     "options_short": ["Никогда", "Раз в несколько мес", "Иногда", "Часто"],
     "options": [("Никогда. Мне комфортно в своём кругу.", 1), ("Раз в несколько месяцев. Случайно, неохотно.", 2),
                 ("Иногда. Когда обстоятельства складываются.", 3), ("Часто. Мне нравится открывать людей.", 4)]},
    {"id": "q2", "sphere": "❤️ Социальность", "question": "Какой вариант тебе ближе?",
     "options_short": ["Хочу знакомств", "Хочу глубины", "Мне комфортно", "И новых, и глубины"],
     "options": [("Хочу больше знакомств, но не знаю как начать.", 1), ("Хочу глубже общаться с теми, кто уже рядом.", 2),
                 ("Мне комфортно как есть. Не хочу ничего менять.", 3), ("Хочу и новых людей, и глубины в старых связях.", 4)]},
    {"id": "q3", "sphere": "❤️ Социальность", "question": "Что чаще всего тебя останавливает в общении?",
     "options_short": ["Не знаю как начать", "Боюсь показаться глупым", "Теряюсь в компаниях", "Редко возможности"],
     "options": [("Не знаю, как начать разговор. Замираю.", 1), ("Боюсь показаться навязчивым или глупым.", 2),
                 ("Не люблю большие компании. Теряюсь в них.", 3), ("Просто редко появляются возможности. Не ищу.", 4)]},
    {"id": "q4", "sphere": "🌍 Приключения", "question": "Сколько раз за последний месяц ты делал что-то впервые?",
     "options_short": ["Ни разу", "1-2 раза", "Несколько раз", "Постоянно"],
     "options": [("Ни разу. Всё по накатанной.", 1), ("1–2 раза. Случайно, не специально.", 2),
                 ("Несколько раз. Иногда ловлю себя на новом.", 3), ("Постоянно. Ищу новое и цепляюсь за него.", 4)]},
    {"id": "q5", "sphere": "🌍 Приключения", "question": "Что тебе сейчас хочется?",
     "options_short": ["Больше путешествий", "Больше спонтанности", "Ярких эмоций", "Красивых мест"],
     "options": [("Больше путешествий. Даже маленьких.", 1), ("Больше спонтанности. Чтобы жизнь удивляла.", 2),
                 ("Больше ярких эмоций. Чтобы сердце билось чаще.", 3), ("Больше красивых мест. Чтобы мир казался шире.", 4)]},
    {"id": "q6", "sphere": "🌍 Приключения", "question": "Что мешает тебе вырваться из рутины?",
     "options_short": ["Деньги", "Время", "Страшно одному", "Нет идей"],
     "options": [("Деньги. Хочу, но не могу позволить.", 1), ("Время. Работа/учёба съедает всё.", 2),
                 ("Страшно одному. А с кем — непонятно.", 3), ("Не приходят идеи. Не знаю, что попробовать.", 4)]},
    {"id": "q7", "sphere": "💪 Смелость", "question": "Когда появляется возможность попробовать что-то новое...",
     "options_short": ["Отказываюсь", "Думаю долго", "Иногда пробую", "Обычно пробую"],
     "options": [("Почти всегда отказываюсь. Нахожу отговорку.", 1), ("Думаю слишком долго. Пока думаю — момент уходит.", 2),
                 ("Иногда соглашаюсь. Если настроение правильное.", 3), ("Обычно пробую. Лучше пожалеть о попытке, чем о молчании.", 4)]},
    {"id": "q8", "sphere": "💪 Смелость", "question": "Где хотелось бы стать смелее?",
     "options_short": ["В общении", "В работе/учёбе", "В отношениях", "В самовыражении"],
     "options": [("В общении. Сказать то, что думаю. Начать разговор.", 1), ("В работе/учёбе. Попросить повышения. Сказать «нет».", 2),
                 ("В отношениях. Открыться. Показать уязвимость.", 3), ("В самовыражении. Показать миру, кто я есть.", 4)]},
    {"id": "q9", "sphere": "💪 Смелость", "question": "Что пугает сильнее всего?",
     "options_short": ["Ошибиться", "Получить отказ", "Выглядеть глупо", "Потратить время"],
     "options": [("Ошибиться. И потом жить с этим.", 1), ("Получить отказ. Быть отвергнутым.", 2),
                 ("Выглядеть глупо. Что подумают другие.", 3), ("Потратить время впустую. А вдруг не стоило?", 4)]},
    {"id": "q10", "sphere": "🧠 Саморазвитие", "question": "Что чаще происходит с твоими начинаниями?",
     "options_short": ["Начинаю и бросаю", "Откладываю", "Учусь понемногу", "Регулярно развиваюсь"],
     "options": [("Начинаю и бросаю. Снова. И снова. Устал от этого.", 1), ("Постоянно откладываю. «Начну с понедельника».", 2),
                 ("Учусь понемногу. Медленно, но не бросаю.", 3), ("Регулярно развиваюсь. Нашёл свой ритм.", 4)]},
    {"id": "q11", "sphere": "🧠 Саморазвитие", "question": "Чему давно хочется научиться, но руки не доходят?",
     "options_short": ["Творческому", "Физическому", "Интеллектуальному", "Не знаю что"],
     "options": [("Чему-то творческому. Рисовать, писать, музыка, фото.", 1), ("Физическому. Танцы, спорт, йога, вёрстка.", 2),
                 ("Интеллектуальному. Язык, программирование, наука.", 3), ("Ничему конкретному. Не знаю, что меня зажжёт.", 4)]},
    {"id": "q12", "sphere": "🧠 Саморазвитие", "question": "Что обычно мешает?",
     "options_short": ["Нет времени", "Нет дисциплины", "Паралич выбора", "Теряю интерес"],
     "options": [("Нет времени. Жизнь съедает всё.", 1), ("Нет дисциплины. Не могу заставить себя.", 2),
                 ("Не знаю, с чего начать. Паралич выбора.", 3), ("Быстро теряю интерес. Зажигаюсь и гасну.", 4)]},
    {"id": "q13", "sphere": "⚡ Энергия", "question": "Что сейчас чаще всего?",
     "options_short": ["Скука", "Усталость", "Тревога", "Рутина"],
     "options": [("Скука. Дни сливаются в одно серое пятно.", 1), ("Усталость. Даже отдых не восстанавливает.", 2),
                 ("Тревога. Мысли крутятся, не дают покоя.", 3), ("Рутина. Всё по расписанию, но без души.", 4)]},
    {"id": "q14", "sphere": "⚡ Энергия", "question": "Чего не хватает?",
     "options_short": ["Азарта", "Спокойствия", "Вдохновения", "Радости"],
     "options": [("Азарта. Чтобы хотелось просыпаться утром.", 1), ("Спокойствия. Чтобы голова внутри затихла.", 2),
                 ("Вдохновения. Чтобы глаза снова горели.", 3), ("Радости. Чтобы было за что улыбаться.", 4)]},
    {"id": "q15", "sphere": "⚡ Энергия", "question": "После какого дня ты обычно чувствуешь себя живым?",
     "options_short": ["После общения", "После спорта", "После путешествия", "После творчества", "После отдыха"],
     "options": [("После общения. Когда по-настоящему поговорил.", 1), ("После спорта. Когда тело напомнило, что оно есть.", 2),
                 ("После путешествия. Даже маленького. Даже в соседний район.", 3), ("После творчества. Когда создал что-то своё руками.", 4),
                 ("После спокойного отдыха. Когда никто не трогал.", 5)]},
    {"id": "q16", "sphere": "📋 Дисциплина", "question": "Как ты относишься к обещаниям, которые даёшь самому себе?",
     "options_short": ["Не верю себе", "Слабо доверяю", "Умеренно", "Полностью доверяю"],
     "options": [("Не верю себе. Уже столько раз обещал и не сделал.", 1), ("Слабо доверяю. Иногда получается, чаще — нет.", 2),
                 ("Умеренно. Стараюсь, но бывают провалы.", 3), ("Полностью доверяю. Если сказал — сделаю.", 4)]},
    {"id": "q17", "sphere": "📋 Дисциплина", "question": "Сколько у тебя «висящих» дел, которые давно надо закрыть?",
     "options_short": ["Гора дел", "Несколько штук", "Почти всё сделано", "Всё под контролем"],
     "options": [("Гора. Давно перестал считать. Тревожит.", 1), ("Несколько штук. Висят, но не мешают сильно.", 2),
                 ("Почти всё сделано. Немного осталось.", 3), ("Всё под контролем. Голова чистая.", 4)]},
    {"id": "q18", "sphere": "📋 Дисциплина", "question": "Как ты обычно начинаешь утро?",
     "options_short": ["В телефон", "В спешке", "По привычке", "Осознанно"],
     "options": [("В телефон. Листаю ленту, не замечая, как проходит час.", 1), ("В спешке. Опоздал, всё на бегу, нет времени подумать.", 2),
                 ("По привычке. Кофе, душ, работа. Автопилот.", 3), ("Осознанно. Есть ритуал, который заряжает.", 4)]},
    {"id": "q19", "sphere": "🎨 Творчество", "question": "Когда последний раз ты делал что-то руками, не для работы?",
     "options_short": ["Не помню", "Месяц назад", "Неделю назад", "Недавно"],
     "options": [("Не помню. Всё кажется бессмысленным.", 1), ("Месяц назад. Было приятно, но не повторял.", 2),
                 ("Неделю назад. Иногда тянет, но редко.", 3), ("Недавно. Творчество — мой способ дышать.", 4)]},
    {"id": "q20", "sphere": "🎨 Творчество", "question": "Есть ли у тебя способ выразить себя, когда слов не хватает?",
     "options_short": ["Нет", "Было, забросил", "Есть, но редко", "Да, часто"],
     "options": [("Нет. Не знаю, как выразить то, что внутри.", 1), ("Было, но забросил. Давно не возвращался.", 2),
                 ("Есть, но редко. Когда настроение особенное.", 3), ("Да. Это часть меня. Не могу без этого.", 4)]},
    {"id": "q21", "sphere": "🎨 Творчество", "question": "Как ты относишься к выходу из зоны комфорта?",
     "options_short": ["Боюсь", "Неохотно", "Стараюсь", "Люблю"],
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
def build_question_keyboard(q_id: str, options: list, options_short: list) -> InlineKeyboardMarkup:
    buttons = []
    for short, (_, value) in zip(options_short, options):
        buttons.append([InlineKeyboardButton(text=short, callback_data="{}_{}".format(q_id, value))])
    return InlineKeyboardMarkup(inline_keyboard=buttons)

def build_bingo_keyboard(completed: list) -> InlineKeyboardMarkup:
    cells = [
        ("🌅 Утро", "cell_morning"), ("📋 План", "cell_plan"), ("💪 Движение", "cell_move"),
        ("🌍 Приключение", "cell_adventure1"), ("🐸 ЛЯГУШКА", "cell_frog"), ("🎲 Рандом", "cell_random"),
        ("😨 Страх", "cell_fear"), ("🔥 Испытание", "cell_challenge"), ("✨ Проявление", "cell_expression"),
    ]
    buttons = []
    row = []
    for i, (text, data) in enumerate(cells):
        prefix = "✅ " if data in completed else ""
        row.append(InlineKeyboardButton(text="{}{}".format(prefix, text), callback_data="bingo_{}".format(data)))
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
    options_text = "\n".join(["{}. {}".format(i+1, opt[0]) for i, opt in enumerate(q["options"])])
    text = "🧭 <b>Диагностика: где ты сейчас?</b>\n\n<b>" + q["sphere"] + "</b>\n\n" + q["question"] + "\n\n" + options_text
    await callback.message.edit_text(
        text,
        parse_mode="HTML",
        reply_markup=build_question_keyboard(q["id"], q["options"], q["options_short"])
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
        await state.set_state(SurveyStates.analyzing)
        await callback.message.edit_text(
            "🧠 <b>Анализирую твои ответы...</b>\n"
            "Создаю персональный профиль и бинго-карту. Это займёт несколько секунд.",
            parse_mode="HTML"
        )
        await generate_and_send_profile(callback.message, user_id)
        await state.clear()
    else:
        next_q = SURVEY_QUESTIONS[next_idx]
        next_state = list(STATE_MAP.keys())[list(STATE_MAP.values()).index(next_idx)]
        await state.set_state(next_state)

        progress = "\n<i>Вопрос {} из {}</i>".format(next_idx + 1, len(SURVEY_QUESTIONS))
        options_text = "\n".join(["{}. {}".format(i+1, opt[0]) for i, opt in enumerate(next_q["options"])])
        text = "🧭 <b>Диагностика: где ты сейчас?</b>" + progress + "\n\n<b>" + next_q["sphere"] + "</b>\n\n" + next_q["question"] + "\n\n" + options_text
        await callback.message.edit_text(
            text,
            parse_mode="HTML",
            reply_markup=build_question_keyboard(next_q["id"], next_q["options"], next_q["options_short"])
        )

    await callback.answer()

# ==================== IMAGE GENERATION ====================
BINGO_COLORS = {
    "morning": ("#2E7D32", "#E8F5E9"),    # Зелёный
    "plan": ("#1565C0", "#E3F2FD"),       # Синий
    "move": ("#EF6C00", "#FFF3E0"),       # Оранжевый
    "adventure1": ("#00838F", "#E0F7FA"), # Бирюзовый
    "frog": ("#C62828", "#FFEBEE"),       # Красный
    "random": ("#6A1B9A", "#F3E5F5"),     # Фиолетовый
    "fear": ("#4527A0", "#EDE7F6"),       # Тёмно-фиолетовый
    "challenge": ("#D84315", "#FBE9E7"),  # Оранжево-красный
    "expression": ("#AD1457", "#FCE4EC"), # Розовый
}

def create_bingo_image(tasks: dict, completed: list) -> io.BytesIO:
    """Генерирует PNG-картинку бинго-карты"""
    try:
        cell_width = 300
        cell_height = 160
        gap = 8
        cols = 3
        rows = 3
        
        img_width = cols * cell_width + (cols + 1) * gap
        img_height = rows * cell_height + (rows + 1) * gap + 60
        
        img = Image.new('RGB', (img_width, img_height), '#1A1A2E')
        draw = ImageDraw.Draw(img)
        
        # Загружаем шрифты или используем дефолт
        try:
            title_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
            header_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
            text_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
        except:
            try:
                title_font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", 24)
                header_font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", 18)
                text_font = ImageFont.truetype("/usr/share/fonts/TTF/DejaVuSans.ttf", 13)
            except:
                title_font = ImageFont.load_default()
                header_font = ImageFont.load_default()
                text_font = ImageFont.load_default()
        
        # Заголовок
        draw.text((img_width//2, 25), "BINGO CARD", fill='white', font=title_font, anchor="mm")
        
        cells = [
            ("morning", "UTRO", "#2E7D32"),
            ("plan", "PLAN", "#1565C0"),
            ("move", "DVIZHENIE", "#EF6C00"),
            ("adventure1", "PRIKLYUCHENIE", "#00838F"),
            ("frog", "LYAGUSHKA", "#C62828"),
            ("random", "RANDOM", "#6A1B9A"),
            ("fear", "STRAH", "#4527A0"),
            ("challenge", "ISPYTANIE", "#D84315"),
            ("expression", "PROYAVLENIE", "#AD1457"),
        ]
        
        for idx, (cell_key, title, color) in enumerate(cells):
            row = idx // 3
            col = idx % 3
            
            x = gap + col * (cell_width + gap)
            y = 50 + gap + row * (cell_height + gap)
            
            # Фон карточки
            if cell_key in completed:
                bg_color = "#1B5E20"
            else:
                bg_color = "#252540"
            
            # Прямоугольник (без скругления для совместимости)
            draw.rectangle([x, y, x + cell_width, y + cell_height], outline=color, width=2, fill=bg_color)
            
            # Заголовок
            draw.text((x + 10, y + 8), title, fill=color, font=header_font)
            
            # Описание
            task_text = tasks.get(cell_key, "Zadanie")
            task_text = task_text.replace("<b>", "").replace("</b>", "")
            
            # Перенос строк
            words = task_text.split()
            lines = []
            current = ""
            for word in words:
                test = current + " " + word if current else word
                if len(test) < 30:
                    current = test
                else:
                    lines.append(current)
                    current = word
            if current:
                lines.append(current)
            
            line_y = y + 40
            for line in lines[:3]:
                draw.text((x + 10, line_y), line, fill='#BBBBBB', font=text_font)
                line_y += 16
            
            # Галочка
            if cell_key in completed:
                draw.text((x + cell_width - 30, y + cell_height - 25), "V", fill='#4CAF50', font=header_font)
        
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        print("Image created successfully: {}x{}, {} bytes".format(img_width, img_height, len(buffer.getvalue())))
        return buffer
        
    except Exception as e:
        print("CRITICAL ERROR in create_bingo_image: {}".format(str(e)))
        import traceback
        traceback.print_exc()
        # Возвращаем заглушку
        img = Image.new('RGB', (400, 200), '#1A1A2E')
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
        except:
            font = ImageFont.load_default()
        draw.text((200, 100), "BINGO", fill='white', font=font, anchor="mm")
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        return buffer
        
    except Exception as e:
        print("ERROR in create_bingo_image: {}".format(str(e)))
        # Возвращаем пустую картинку-заглушку
        img = Image.new('RGB', (400, 200), '#1A1A2E')
        draw = ImageDraw.Draw(img)
        font = ImageFont.load_default()
        draw.text((200, 100), "BINGO CARD", fill='white', font=font, anchor="mm")
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        return buffer

# ==================== GROQ GENERATION ====================
async def generate_and_send_profile(message, user_id: int):
    answers = get_all_answers(user_id)
    answers_json = json.dumps(answers, ensure_ascii=False)

    # Промпт для профиля (обращение на "ты")
    profile_prompt = "Ты — LifeQuest, тёплый и внимательный коуч.\nПроанализируй ответы пользователя и напиши профиль, обращаясь к нему напрямую на 'ты'.\nИспользуй тёплый, поддерживающий тон. Не диагностируй, а делись наблюдениями.\nУкажи одну сильную сторону и одну зону роста.\n\nОтветы пользователя:\n" + answers_json + "\n\nНапиши 2-3 предложения. Обращайся к нему лично."

    # Промпт для оценок сфер
    scores_prompt = "На основе этих ответов (1-4 шкала) оцени 7 сфер жизни в процентах (0-100).\nСферы: social, adventure, courage, growth, energy, discipline, creativity.\nВерни ТОЛЬКО JSON с английскими ключами: {\"social\": 58, \"adventure\": 83, \"courage\": 67, \"growth\": 75, \"energy\": 92, \"discipline\": 42, \"creativity\": 70}\n\nОтветы:\n" + answers_json

    # Промпт для персональных заданий
    tasks_prompt = "Ты — LifeQuest, мотивационный коуч и игровой дизайнер.\nСоздай 9 персональных челленджей для бинго-карты на неделю.\n\nПрофиль пользователя:\n" + answers_json + "\n\nПравила:\n1. Каждое задание конкретное, выполнимое за 1 день\n2. Учитывай слабые сферы — там чуть сложнее\n3. Учитывай сильные сферы — там для закрепления\n4. Добавь элемент игры или случайности\n5. Формат: короткое описание (1-2 предложения)\n\nВерни JSON в формате:\n{\n  \"morning\": \"30 мин без телефона после пробуждения. Выпей воды, сделай 5 вдохов.\",\n  \"plan\": \"Запиши 3 дела на завтра. Одно — то, что откладывал больше недели.\",\n  \"move\": \"15 мин растяжки или прогулка без цели. Не слушай подкасты — просто иди.\",\n  \"adventure1\": \"Дойди до незнакомого места в радиусе 3 км. Посиди там 15 мин без телефона.\",\n  \"frog\": \"Закрой самое тяжёлое висящее дело. Сделай фото 'до/после'.\",\n  \"random\": \"Кинь кубик: 1-3 = приготовь новое блюдо, 4-6 = новый маршрут домой.\",\n  \"fear\": \"Сделай то, что давно боишься: звонок, разговор, первый шаг. Отметь в дневнике.\",\n  \"challenge\": \"Согласись на спонтанное предложение сегодня. Или сам предложи кому-то встречу.\",\n  \"expression\": \"Опубликуй что-то своё без фильтров: рисунок, мысль, фото. Честно. Для себя.\"\n}"

    try:
        print("Starting profile generation for user {}".format(user_id))
        
        # Генерируем профиль с таймаутом
        profile_response = await asyncio.wait_for(
            client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": profile_prompt}],
                temperature=0.7,
                max_tokens=300
            ),
            timeout=30.0
        )
        profile_text = profile_response.choices[0].message.content.strip()
        print("Profile generated successfully")

        # Генерируем оценки с таймаутом
        scores_response = await asyncio.wait_for(
            client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": scores_prompt}],
                temperature=0.3,
                max_tokens=200
            ),
            timeout=30.0
        )
        scores_content = scores_response.choices[0].message.content
        print("Scores raw response: {}".format(scores_content[:200]))
        
        # Извлекаем JSON
        json_start = scores_content.find("{")
        json_end = scores_content.rfind("}") + 1
        if json_start == -1 or json_end == 0:
            raise ValueError("No JSON found in scores response")
        scores_raw = json.loads(scores_content[json_start:json_end])
        
        # Маппим английские ключи на русские для отображения
        key_mapping = {
            "social": "Социальность",
            "adventure": "Приключения",
            "courage": "Смелость",
            "growth": "Саморазвитие",
            "energy": "Энергия",
            "discipline": "Дисциплина",
            "creativity": "Творчество"
        }
        scores = {}
        for eng, rus in key_mapping.items():
            scores[rus] = scores_raw.get(eng, 50)
        print("Scores parsed successfully: {}".format(scores))

        # Генерируем персональные задания с таймаутом
        tasks_response = await asyncio.wait_for(
            client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": tasks_prompt}],
                temperature=0.8,
                max_tokens=800
            ),
            timeout=30.0
        )
        tasks_content = tasks_response.choices[0].message.content
        print("Tasks raw response: {}".format(tasks_content[:200]))
        
        json_start = tasks_content.find("{")
        json_end = tasks_content.rfind("}") + 1
        if json_start == -1 or json_end == 0:
            raise ValueError("No JSON found in tasks response")
        personal_tasks = json.loads(tasks_content[json_start:json_end])
        print("Tasks parsed successfully")

        # Формируем текст профиля
        scores_lines = []
        for k, v in scores.items():
            filled = '█' * int(v/10)
            empty = '░' * (10 - int(v/10))
            scores_lines.append("{} {}{} {}%".format(k, filled, empty, v))
        scores_text = "\n".join(scores_lines)

        full_profile = "🎯 <b>Твой профиль</b>\n\n" + profile_text + "\n\n📊 <b>Сферы:</b>\n<pre>" + scores_text + "</pre>\n\n<i>Теперь — твоя персональная бинго-карта на неделю!</i>"

        save_user_profile(user_id, profile_text, json.dumps(scores), json.dumps(personal_tasks))

        await message.edit_text(full_profile, parse_mode="HTML")

        # Отправляем бинго-карту
        await send_bingo_card(message, user_id, personal_tasks)

    except asyncio.TimeoutError:
        print("TIMEOUT: Groq API took too long for user {}".format(user_id))
        await message.edit_text(
            "⏱ <b>ИИ думает слишком долго...</b>\n\n"
            "Попробую отправить упрощённую версию. Нажми /start, чтобы пройти опрос заново.",
            parse_mode="HTML"
        )
    except Exception as e:
        print("Error generating profile: {}".format(str(e)))
        # Fallback
        fallback_scores = {
            "Социальность": 50, "Приключения": 50, "Смелость": 50,
            "Саморазвитие": 50, "Энергия": 50, "Дисциплина": 50, "Творчество": 50
        }
        fallback_tasks = {
            "morning": "30 мин без телефона после пробуждения",
            "plan": "Запиши 3 дела на день. 1 — то, что откладывал",
            "move": "15 мин растяжки или прогулка без цели",
            "adventure1": "Дойди до незнакомого места в радиусе 3 км",
            "frog": "Закрой самое тяжёлое висящее дело. Фото «до/после»",
            "random": "Кинь кубик: 1-3 = новое блюдо, 4-6 = новый маршрут",
            "fear": "Сделай то, что давно боишься: звонок, разговор, шаг",
            "challenge": "Согласись на спонтанное предложение. Или скажи «да»",
            "expression": "Опубликуй что-то своё без фильтров. Честно. Для себя",
        }
        await message.edit_text(
            "🎯 <b>Твой профиль</b>\n\n"
            "Я вижу, что ты хочешь ярких впечатлений, но между желанием и действием стоит страх ошибки. "
            "Поэтому задания подобраны так, чтобы начать с малого и постепенно расширить твою зону возможностей.\n\n"
            "🎲 <b>Твоя бинго-карта на неделю:</b>",
            parse_mode="HTML"
        )
        save_user_profile(user_id, "Профиль создан.", json.dumps(fallback_scores), json.dumps(fallback_tasks))
        await send_bingo_card(message, user_id, fallback_tasks)

async def send_bingo_card(message, user_id: int, tasks: dict = None):
    completed = get_completed_cells(user_id)
    
    if tasks is None:
        _, _, tasks_json = get_user_profile(user_id)
        tasks = json.loads(tasks_json) if tasks_json else {}

    try:
        print("Creating bingo image for user {}".format(user_id))
        # Генерируем картинку
        img_buffer = create_bingo_image(tasks, completed)
        print("Bingo image created, size: {} bytes".format(len(img_buffer.getvalue())))
        
        # Отправляем фото с кнопками
        await message.answer_photo(
            photo=InputFile(img_buffer, filename="bingo.png"),
            caption="🎯 <b>Твоя бинго-карта на неделю</b>\n\nНажми на клетку, чтобы отметить выполнение 👇",
            parse_mode="HTML",
            reply_markup=build_bingo_keyboard(completed)
        )
        print("Bingo card sent successfully")
    except Exception as e:
        print("ERROR sending bingo card: {}".format(str(e)))
        # Fallback - отправляем текстом
        await message.answer(
            "🎯 <b>Твоя бинго-карта на неделю</b>\n\n"
            "Утро | План | Движение\n"
            "Приключение | ЛЯГУШКА | Рандом\n"
            "Страх | Испытание | Проявление\n\n"
            "Нажми на клетку ниже 👇",
            parse_mode="HTML",
            reply_markup=build_bingo_keyboard(completed)
        )

# ==================== BINGO INTERACTION ====================
@dp.callback_query(F.data.startswith("bingo_cell_"))
async def handle_bingo_click(callback: CallbackQuery, state: FSMContext):
    cell = callback.data.replace("bingo_cell_", "")
    user_id = callback.from_user.id
    
    _, _, tasks_json = get_user_profile(user_id)
    tasks = json.loads(tasks_json) if tasks_json else {}
    task_text = tasks.get(cell, "Zadanie")

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Выполнено!", callback_data="complete_{}".format(cell))],
        [InlineKeyboardButton(text="📸 Прикрепить фото", callback_data="photo_{}".format(cell))],
        [InlineKeyboardButton(text="« Назад к карте", callback_data="back_to_bingo")]
    ])

    await callback.message.edit_text(task_text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("complete_"))
async def complete_task(callback: CallbackQuery):
    cell = callback.data.replace("complete_", "")
    user_id = callback.from_user.id
    
    _, _, tasks_json = get_user_profile(user_id)
    tasks = json.loads(tasks_json) if tasks_json else {}
    task_text = tasks.get(cell, "Zadanie")

    save_completed_task(user_id, cell, task_text)

    completed = get_completed_cells(user_id)

    await callback.message.edit_text(
        "✅ <b>Клетка выполнена!</b>\n\n" + task_text + "\n\n"
        "Отличная работа! Продолжай в том же духе.",
        parse_mode="HTML"
    )

    await callback.message.answer(
        "🎲 <b>Твоя бинго-карта</b>",
        reply_markup=build_bingo_keyboard(completed)
    )
    await callback.answer("🎉 Молодец!")

@dp.callback_query(F.data == "back_to_bingo")
async def back_to_bingo(callback: CallbackQuery):
    user_id = callback.from_user.id
    completed = get_completed_cells(user_id)
    _, _, tasks_json = get_user_profile(user_id)
    tasks = json.loads(tasks_json) if tasks_json else {}
    await send_bingo_card(callback.message, user_id, tasks)
    await callback.answer()

# ==================== PHOTO UPLOAD ====================
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

    completed = get_completed_cells(user_id)

    await message.answer("📸 Фото добавлено на карту твоей жизни!")
    await message.answer("🎲 <b>Твоя бинго-карта</b>", reply_markup=build_bingo_keyboard(completed))
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
                    "🌅 <b>Доброе утро!</b>\n\n"
                    "Новый день — новая возможность зачеркнуть клетку в бинго.\n"
                    "Какое задание выберешь сегодня?",
                    parse_mode="HTML",
                    reply_markup=build_bingo_keyboard(completed)
                )
        except Exception as e:
            print("Failed to send reminder to {}: {}".format(user_id, e))

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

    text = "📊 <b>Статистика</b>\n\n" + \
           "Пользователей: {}\n".format(users_count) + \
           "Выполнено заданий: {}\n".format(tasks_count) + \
           "Фото на карте жизни: {}".format(photos_count)

    await message.answer(text, parse_mode="HTML")

# ==================== MAIN ====================
async def main():
    scheduler.add_job(send_daily_reminders, "cron", hour=9, minute=0)
    scheduler.start()

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

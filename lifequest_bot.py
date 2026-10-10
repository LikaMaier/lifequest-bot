# ============================================================
# LIFQUEST BOT — Telegram Bot Template (aiogram 3.x)
# ============================================================

import asyncio
import base64
import html
import json
import os
import random
from datetime import datetime

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, 
    InlineKeyboardButton, BotCommand, KeyboardButton, ReplyKeyboardMarkup,
    WebAppInfo, MenuButtonWebApp
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

load_dotenv()  # до импорта storage: он читает DB_PATH при загрузке

import api
import game
import habits
import photos
import plans
import storage
from quests_database import KEY_TO_TASK, ALL_TASKS_FLAT, COMPANY_QUESTS, PAIR_QUESTS
from storage import (
    connect, init_db, ensure_user, get_active_quests, get_active_quest,
    get_recent_completed_texts, get_monthly_completed_count,
    get_users_with_completions, get_completed_today,
    BOARD_CELLS, get_weekly_board, normalize_board, get_week_range_label,
)

init_db()

# ==================== CONFIG ====================
BOT_TOKEN = os.getenv("BOT_TOKEN")  # @BotFather
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

scheduler = AsyncIOScheduler()

# ==================== KEYBOARD BUILDER ====================
# ==================== WELCOME ====================
WELCOME_TEXT = """👋 <b>Привет! Добро пожаловать в LifeQuest.</b>

Моя работа — подкидывать тебе задания, после которых можно сказать:
«Это была ужасно странная идея...»
«Но почему-то я рад(а), что мы это сделали».

Здесь не будет:
❌ «сходи в кино»
❌ «почитай книгу»
❌ «попробуй новое хобби»

Слишком легко.

Вместо этого тебе может выпасть:
🕵️ расследовать загадочную историю
🗺️ уехать туда, где ты никогда не был(а)
🎭 на один вечер стать совершенно другим человеком
🗣️ заговорить с незнакомцем и узнать его историю
🎲 отдать часть решений случайности
❤️ устроить свидание, которое никто не сможет повторить
👯 втянуть друзей в авантюру, о которой они не просили

<b>Как играем:</b>
1️⃣ Выбираешь формат
2️⃣ Получаешь задание
3️⃣ Выполняешь
4️⃣ Возвращаешься за следующим

Некоторые задания займут час. Некоторые — целый день.

Твоя задача — выбраться из привычного сценария. Моя — придумать, как.

🎲 <b>Выбери формат:</b>
🎯 На одного — приключение для себя
💞 Для пары — задание на двоих
👥 Для компании — что-то странное для друзей

Какое приключение начнём сегодня?"""

def build_start_menu_keyboard() -> InlineKeyboardMarkup:
    rows = [[build_miniapp_button()]] if MINIAPP_URL else []
    return InlineKeyboardMarkup(inline_keyboard=rows + [
        [InlineKeyboardButton(text="🎯 На одного", callback_data="menu_solo")],
        [InlineKeyboardButton(text="💞 Для пары", callback_data="menu_pair")],
        [InlineKeyboardButton(text="👥 Для компании", callback_data="menu_company")],
        [InlineKeyboardButton(text="🗺️ Карта недели", callback_data="menu_board")],
    ])

@dp.message(CommandStart())
async def cmd_start(message: Message):
    user_id = message.from_user.id
    ensure_user(user_id, message.from_user.username, message.from_user.first_name)
    await message.answer(WELCOME_TEXT, parse_mode="HTML", reply_markup=build_start_menu_keyboard())


# ==================== QUEST BANK ====================
# Сами задания вынесены в quests_database.py.
def get_random_solo_task():
    """Один случайный квест из всего банка (любая сфера, равновероятно) —
    основа механики «На одного»: показывается один на выбор, можно взять или
    поменять на другой. Уровень сложности — случайный из того, что у задания
    реально есть (часть заданий теперь только среднего уровня, без лёгкого)."""
    task = random.choice(ALL_TASKS_FLAT)
    available_tiers = [t for t in ("easy", "medium") if t in task]
    tier = random.choice(available_tiers)
    return task, tier


def build_group_quest_message(quest_list: list, callback_prefix: str):
    quest = random.choice(quest_list)
    text = f"👥 <b>{quest['label']}</b>\n\n{quest['text']}"
    if quest.get("outcome"):
        text += f"\n\n<i>Что может произойти: {quest['outcome']}</i>"
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Принять вызов", callback_data=f"{callback_prefix}_accept_{quest['key']}")],
        [InlineKeyboardButton(text="🔄 Поменять", callback_data=f"{callback_prefix}_reroll")]
    ])
    return text, kb

async def accept_group_quest(callback: CallbackQuery, quest_list: list, prefix: str):
    """Общий обработчик «Принять вызов» для /company и /pair — так же, как
    в «На одного» и «Задании дня», добавляет в «Мои квесты»."""
    user_id = callback.from_user.id
    quest_key = callback.data.replace(prefix, "")
    quest = next((q for q in quest_list if q["key"] == quest_key), None)
    if not quest:
        await callback.answer("Этот квест уже недоступен, попробуй ещё раз")
        return

    ensure_user(user_id, callback.from_user.username, callback.from_user.first_name)
    game.accept_quest(user_id, quest["key"])

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📋 Мои квесты", callback_data="menu_myquests")]
    ])
    await callback.message.edit_text(
        f"✅ <b>Квест добавлен в «Мои квесты»!</b>\n\n{quest['label']}",
        parse_mode="HTML",
        reply_markup=kb
    )
    await callback.answer()

@dp.message(Command("company"))
async def cmd_company_quest(message: Message):
    text, kb = build_group_quest_message(COMPANY_QUESTS, "company")
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@dp.callback_query(F.data == "menu_company")
async def menu_company_quest(callback: CallbackQuery):
    text, kb = build_group_quest_message(COMPANY_QUESTS, "company")
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data == "company_reroll")
async def reroll_company_quest(callback: CallbackQuery):
    text, kb = build_group_quest_message(COMPANY_QUESTS, "company")
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("company_accept_"))
async def company_quest_accept(callback: CallbackQuery):
    await accept_group_quest(callback, COMPANY_QUESTS, "company_accept_")

@dp.message(Command("pair"))
async def cmd_pair_quest(message: Message):
    text, kb = build_group_quest_message(PAIR_QUESTS, "pair")
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@dp.callback_query(F.data == "menu_pair")
async def menu_pair_quest(callback: CallbackQuery):
    text, kb = build_group_quest_message(PAIR_QUESTS, "pair")
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data == "pair_reroll")
async def reroll_pair_quest(callback: CallbackQuery):
    text, kb = build_group_quest_message(PAIR_QUESTS, "pair")
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("pair_accept_"))
async def pair_quest_accept(callback: CallbackQuery):
    await accept_group_quest(callback, PAIR_QUESTS, "pair_accept_")

# ==================== SOLO QUEST (На одного) ====================
def build_solo_quest_message(task: dict, tier: str):
    text = task[tier]
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Взять задание", callback_data=f"solo_take_{task['key']}_{tier}")],
        [InlineKeyboardButton(text="🔄 Поменять задание", callback_data="solo_swap")]
    ])
    return text, kb

@dp.message(Command("solo"))
async def cmd_solo(message: Message):
    task, tier = get_random_solo_task()
    text, kb = build_solo_quest_message(task, tier)
    await message.answer(text, parse_mode="HTML", reply_markup=kb)

@dp.callback_query(F.data == "menu_solo")
async def menu_solo(callback: CallbackQuery):
    task, tier = get_random_solo_task()
    text, kb = build_solo_quest_message(task, tier)
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data == "solo_swap")
async def solo_swap(callback: CallbackQuery):
    task, tier = get_random_solo_task()
    text, kb = build_solo_quest_message(task, tier)
    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("solo_take_"))
async def solo_take(callback: CallbackQuery):
    user_id = callback.from_user.id
    _, _, task_key, tier = callback.data.split("_", 3)
    task = KEY_TO_TASK.get(task_key)
    if not task:
        await callback.answer("Это задание уже недоступно, попробуй ещё раз /start")
        return

    task_text = task[tier]
    ensure_user(user_id, callback.from_user.username, callback.from_user.first_name)
    game.accept_quest(user_id, task_key, tier)

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📋 Мои квесты", callback_data="menu_myquests")],
        [InlineKeyboardButton(text="🎯 Взять ещё один", callback_data="menu_solo")]
    ])
    await callback.message.edit_text(
        f"✅ <b>Квест добавлен в «Мои квесты»!</b>\n\n{task_text}",
        parse_mode="HTML",
        reply_markup=kb
    )
    await callback.answer()

# ==================== MY QUESTS / COMPLETED ====================
def build_my_quests_keyboard(quests: list) -> InlineKeyboardMarkup:
    buttons = [[InlineKeyboardButton(text=text[:60], callback_data=f"myquest_open_{qid}")]
               for qid, _key, text, _taken_at in quests]
    buttons.append([InlineKeyboardButton(text="🎯 Взять ещё один", callback_data="menu_solo")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)

async def show_my_quests(target, user_id: int, as_edit: bool):
    quests = get_active_quests(user_id)
    if not quests:
        text = "📋 <b>Мои квесты</b>\n\nПока пусто. Возьми первый квест кнопкой ниже."
        kb = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎯 На одного", callback_data="menu_solo")]
        ])
    else:
        text = f"📋 <b>Мои квесты</b> ({len(quests)})\n\nЖми на задание, чтобы открыть и отметить выполнение."
        kb = build_my_quests_keyboard(quests)

    if as_edit:
        await target.edit_text(text, parse_mode="HTML", reply_markup=kb)
    else:
        await target.answer(text, parse_mode="HTML", reply_markup=kb)

@dp.message(Command("myquests"))
async def cmd_my_quests(message: Message):
    await show_my_quests(message, message.from_user.id, as_edit=False)

@dp.callback_query(F.data == "menu_myquests")
async def menu_my_quests(callback: CallbackQuery):
    await show_my_quests(callback.message, callback.from_user.id, as_edit=True)
    await callback.answer()

@dp.callback_query(F.data.startswith("myquest_open_"))
async def open_my_quest(callback: CallbackQuery):
    user_id = callback.from_user.id
    quest_id = int(callback.data.replace("myquest_open_", ""))
    quest = get_active_quest(user_id, quest_id)
    if not quest:
        await callback.answer("Этот квест уже не найден — возможно, уже выполнен.")
        return
    _id, task_key, task_text = quest

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Выполнено!", callback_data=f"myquest_done_{quest_id}")],
        [InlineKeyboardButton(text="« Назад к моим квестам", callback_data="menu_myquests")]
    ])
    await callback.message.edit_text(task_text, parse_mode="HTML", reply_markup=kb)
    await callback.answer()

@dp.callback_query(F.data.startswith("myquest_done_"))
async def complete_my_quest(callback: CallbackQuery):
    user_id = callback.from_user.id
    quest_id = int(callback.data.replace("myquest_done_", ""))

    result = game.complete_quest(user_id, quest_id)
    if not result:
        await callback.answer("Этот квест уже отмечен выполненным.")
        await show_my_quests(callback.message, user_id, as_edit=True)
        return

    note = f"🎉 Засчитано! +{result['xp']} XP"
    if result["level_up"]:
        note += f" · новый уровень: {result['level_up']['name']}"
    await callback.answer(note)
    await show_my_quests(callback.message, user_id, as_edit=True)

async def show_completed_quests(target, user_id: int, as_edit: bool):
    rows = get_recent_completed_texts(user_id, limit=20)
    if not rows:
        text = "🏆 <b>Выполненные</b>\n\nПока пусто — здесь появятся квесты, которые ты отметишь выполненными."
    else:
        lines = [f"🏆 <b>Выполненные</b> (последние {len(rows)})\n"]
        lines.extend(f"✅ {t}" for t in rows)
        text = "\n".join(lines)

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📋 Мои квесты", callback_data="menu_myquests")]
    ])
    if as_edit:
        await target.edit_text(text, parse_mode="HTML", reply_markup=kb)
    else:
        await target.answer(text, parse_mode="HTML", reply_markup=kb)

@dp.message(Command("completed"))
async def cmd_completed(message: Message):
    await show_completed_quests(message, message.from_user.id, as_edit=False)

@dp.callback_query(F.data == "menu_completed")
async def menu_completed(callback: CallbackQuery):
    await show_completed_quests(callback.message, callback.from_user.id, as_edit=True)
    await callback.answer()

# ==================== MINI APP ====================
# Мини-апп v2 раздаёт этот же процесс (api.py, папка static/) — он работает
# через HTTP API, поэтому открывается обычной inline-кнопкой и кнопкой меню.
# Старая карта недели (index.html в корне, GitHub Pages) сохраняет данные
# через sendData() и открывается только кнопкой reply-клавиатуры — она
# остаётся запасным вариантом, если адрес нового приложения не задан.
LEGACY_BOARD_URL = os.getenv("LEGACY_BOARD_URL", "https://likamaier.github.io/lifequest-bot/")
BOARD_BUTTON_TEXT = "🗺️ Карта недели"

def resolve_miniapp_url() -> str:
    """MINIAPP_URL, а если он не задан или всё ещё указывает на старую карту
    на GitHub Pages — публичный домен Railway (RAILWAY_PUBLIC_DOMAIN)."""
    url = os.getenv("MINIAPP_URL", "").strip()
    railway = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if (not url or "github.io" in url) and railway:
        url = f"https://{railway}/"
    if url.startswith("https://") and "github.io" not in url:
        return url
    return ""

MINIAPP_URL = resolve_miniapp_url()

def build_miniapp_button(text: str = "✨ Открыть LifeQuest", section: str = "") -> InlineKeyboardButton:
    url = MINIAPP_URL + (f"#{section}" if section else "")
    return InlineKeyboardButton(text=text, web_app=WebAppInfo(url=url))

def build_board_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    """Старая карта (запасной вариант). Текущая карта передаётся в ссылке
    (base64url от JSON) — поэтому после каждого сохранения клавиатура
    отправляется заново."""
    board = get_weekly_board(user_id)
    board["week_range"] = get_week_range_label()
    encoded = base64.urlsafe_b64encode(
        json.dumps(board, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii").rstrip("=")
    sep = "&" if "?" in LEGACY_BOARD_URL else "?"
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(
            text=BOARD_BUTTON_TEXT,
            web_app=WebAppInfo(url=f"{LEGACY_BOARD_URL}{sep}board={encoded}")
        )]],
        resize_keyboard=True,
        is_persistent=True,
    )

async def show_weekly_board_entry(message: Message, user_id: int):
    if MINIAPP_URL:
        await message.answer(
            "🗺️ <b>Карта недели</b>\n\n"
            "Впиши 9 своих задач на неделю, отмечай выполненное и собирай линии — "
            "за каждую линию и полную карту начисляется XP.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [build_miniapp_button("🗺️ Открыть карту недели", "board")]
            ])
        )
        return
    await message.answer(
        "🗺️ <b>Карта недели</b>\n\n"
        "Впиши 9 своих задач на неделю — привычку, что-то новое, тему для изучения "
        "и самое сложное дело в центре. Отмечай клетки по мере выполнения "
        "(тап по правому нижнему углу клетки).\n\n"
        "👇 Открой карту кнопкой под полем ввода.",
        parse_mode="HTML",
        reply_markup=build_board_keyboard(user_id)
    )

@dp.message(Command("habits"))
async def cmd_habits(message: Message):
    ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    if not MINIAPP_URL:
        await message.answer("Трекер привычек живёт в мини-приложении, а оно пока не подключено.")
        return
    await message.answer(
        "🌱 <b>Трекер привычек</b>\n\nПридумай свои привычки, задай, сколько раз в день их выполнять, "
        "и отмечай прогресс — за каждую выполненную за день привычку начисляется XP.",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[build_miniapp_button("🌱 Открыть привычки", "habits")]])
    )

@dp.message(Command("board"))
async def cmd_board(message: Message):
    ensure_user(message.from_user.id, message.from_user.username)
    await show_weekly_board_entry(message, message.from_user.id)

@dp.callback_query(F.data == "menu_board")
async def menu_board(callback: CallbackQuery):
    ensure_user(callback.from_user.id, callback.from_user.username)
    # Reply-клавиатуру нельзя прикрепить редактированием — шлём новое сообщение.
    await show_weekly_board_entry(callback.message, callback.from_user.id)
    await callback.answer()

@dp.message(F.web_app_data)
async def handle_miniapp_data(message: Message):
    """Мини-апп присылает карту через Telegram.WebApp.sendData() по кнопке
    «Сохранить карту»."""
    user_id = message.from_user.id
    try:
        board = normalize_board(json.loads(message.web_app_data.data))
    except (TypeError, ValueError, AttributeError):
        await message.answer("Не получилось сохранить карту — попробуй ещё раз через /board.")
        return

    ensure_user(user_id, message.from_user.username, message.from_user.first_name)
    result = game.save_board(user_id, board)

    filled = sum(1 for c in board["cells"] if c.strip())
    done = sum(1 for c, d in zip(board["cells"], board["done"]) if d and c.strip())
    if filled == BOARD_CELLS and done == BOARD_CELLS:
        text = "🎉 <b>Бинго! Карта недели закрыта полностью.</b>"
        if board["reward"].strip():
            text += f"\n\nТвоя награда: {html.escape(board['reward'])} — ты её заслужил(а)!"
    else:
        text = f"✅ Карта недели сохранена. Выполнено {done} из {BOARD_CELLS}."
    if result["xp"]:
        text += f"\n+{result['xp']} XP"

    await message.answer(text, parse_mode="HTML", reply_markup=build_board_keyboard(user_id))

# ==================== DAILY REMINDERS ====================
def users_at_local_hour(column: str, default_hour: int) -> list:
    """user_id тех, у кого сейчас по их часовому поясу наступил нужный час."""
    conn = connect(rows=True)
    rows = conn.execute(f"SELECT user_id, tz, COALESCE({column}, ?) AS hour FROM users", (default_hour,)).fetchall()
    conn.close()
    return [r["user_id"] for r in rows if game.local_now(dict(r)).hour == r["hour"]]

def build_morning_message(user_id: int):
    """Утреннее сообщение: задание дня (общее для всех) + сколько квестов ждёт."""
    user = storage.get_user(user_id)
    today = game.local_today(user)
    daily_id = game.daily_quest_id(today)
    q = game.public_quest(game.CATALOG[daily_id])
    status = game.daily_status(user_id, today)
    quests = get_active_quests(user_id)

    text = (f"🌅 <b>Доброе утро!</b>\n\n"
            f"⭐ <b>Задание дня</b> — одно на всех сегодня:\n"
            f"{html.escape(q['emoji'])} <b>{html.escape(q['title'])}</b>\n"
            f"{html.escape(q['text'])}\n"
            f"<i>Бонус +{game.DAILY_BONUS} XP за выполнение сегодня.</i>")
    if quests:
        text += f"\n\nВ «Моих квестах» ждут {len(quests)} — самое время закрыть хотя бы один."

    rows = []
    if status is None:
        rows.append([InlineKeyboardButton(text="✅ Принять задание дня", callback_data=f"daily_accept_{daily_id}")])
    rows.append([InlineKeyboardButton(text="📋 Мои квесты", callback_data="menu_myquests")] if quests
                else [InlineKeyboardButton(text="🎯 На одного", callback_data="menu_solo")])
    if MINIAPP_URL:
        rows.append([build_miniapp_button("✨ Открыть LifeQuest")])
    return text, InlineKeyboardMarkup(inline_keyboard=rows)


async def send_daily_reminders():
    """Runs every hour; only messages users whose chosen reminder_hour matches
    their current local hour (часовой пояс из мини-аппа; без него — время
    сервера, как раньше). See /remind. Утром приходит задание дня."""
    for user_id in users_at_local_hour("reminder_hour", 9):
        try:
            text, kb = build_morning_message(user_id)
            await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=kb)
            await send_morning_plans(user_id)
        except Exception as e:
            print(f"Failed to send reminder to {user_id}: {e}")


@dp.callback_query(F.data.startswith("daily_accept_"))
async def daily_accept(callback: CallbackQuery):
    user_id = callback.from_user.id
    key = callback.data[len("daily_accept_"):]
    ensure_user(user_id, callback.from_user.username, callback.from_user.first_name)
    today = game.local_today(storage.get_user(user_id))
    if key != game.daily_quest_id(today):
        await callback.answer("Это задание дня уже прошло — загляни в сегодняшнее 🙂", show_alert=True)
        return
    try:
        result = game.accept_quest(user_id, key, None, daily=True)
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    q = game.public_quest(game.CATALOG[key])
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="📋 Мои квесты", callback_data="menu_myquests")]])
    head = "Задание дня уже у тебя в квестах" if result.get("already") else "Задание дня принято!"
    await callback.message.edit_text(
        f"✅ <b>{head}</b>\n\n{html.escape(q['emoji'])} <b>{html.escape(q['title'])}</b>\n{html.escape(q['text'])}\n\n"
        f"Выполни сегодня — получишь +{game.DAILY_BONUS} XP бонусом.",
        parse_mode="HTML", reply_markup=kb)
    await callback.answer()

def plans_lines(items: list) -> str:
    lines = []
    for o in items[:8]:
        emoji = o["quest"]["emoji"] if o.get("quest") else "📝"
        time = f"{o['time']} — " if o.get("time") else ""
        lines.append(f"• {time}{html.escape(emoji)} {html.escape(o['title'])}")
    if len(items) > 8:
        lines.append(f"…и ещё {len(items) - 8}")
    return "\n".join(lines)


async def send_morning_plans(user_id: int):
    """Утренняя сводка планов (если включена в профиле и планы есть)."""
    user = storage.get_user(user_id)
    if not user.get("morning_plans", 1):
        return
    items = plans.today_plans(user_id)
    if not items:
        return
    markup = InlineKeyboardMarkup(inline_keyboard=[[build_miniapp_button("🗓️ Открыть календарь", "calendar")]]) if MINIAPP_URL else None
    await bot.send_message(user_id, "🗓️ <b>Сегодня у тебя в планах:</b>\n\n" + plans_lines(items),
                           parse_mode="HTML", reply_markup=markup)


async def send_plan_reminders():
    """Каждую минуту: напоминания по планам — в назначенное время или за час
    (по часовому поясу пользователя). Каждое — один раз."""
    for user_id, o in plans.due_reminders():
        plans.mark_reminded(o["id"], o["date"])
        try:
            emoji = o["quest"]["emoji"] if o.get("quest") else "📝"
            head = "⏰ <b>Через час по плану</b>" if o["remind"] == "hour_before" else "⏰ <b>Сейчас по плану</b>"
            text = f"{head}\n\n{html.escape(emoji)} {html.escape(o['title'])} — в {o['time']}"
            if o.get("note"):
                text += f"\n<i>{html.escape(o['note'][:200])}</i>"
            markup = InlineKeyboardMarkup(inline_keyboard=[[build_miniapp_button("Открыть", "calendar")]]) if MINIAPP_URL else None
            await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
        except Exception as e:
            print(f"Failed to send plan reminder to {user_id}: {e}")


async def cleanup_photos():
    try:
        result = photos.cleanup_orphans()
        if result["files"] or result["rows"]:
            print(f"Photo cleanup: {result}")
    except Exception as e:
        print(f"Photo cleanup failed: {e}")


async def send_evening_reminders():
    """Runs every hour; only messages users whose chosen evening_reminder_hour
    matches their current local hour (see /evening). Shows what got done today,
    without judgment if nothing did."""
    for user_id in users_at_local_hour("evening_reminder_hour", 20):
        try:
            today_texts = get_completed_today(user_id)

            if today_texts:
                lines = ["🌙 <b>Как прошёл день?</b>\n\nСегодня отмечено:"]
                lines.extend(f"✅ {t}" for t in today_texts)
                text = "\n".join(lines)
            else:
                text = (
                    "🌙 <b>Как прошёл день?</b>\n\n"
                    "Сегодня пока ничего не отмечено — вечер ещё не кончился, если что-то откликается, самое время."
                )

            habits_block = habits.evening_text(user_id)
            markup = None
            if habits_block:
                text += "\n\n" + habits_block
                if MINIAPP_URL and "▫️" in habits_block:
                    markup = InlineKeyboardMarkup(inline_keyboard=[[build_miniapp_button("🌱 Отметить привычки", "habits")]])

            await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
        except Exception as e:
            print(f"Failed to send evening reminder to {user_id}: {e}")

RU_MONTHS = {
    1: "январь", 2: "февраль", 3: "март", 4: "апрель",
    5: "май", 6: "июнь", 7: "июль", 8: "август",
    9: "сентябрь", 10: "октябрь", 11: "ноябрь", 12: "декабрь",
}

async def send_monthly_recap():
    """Запускается 1 числа каждого месяца: подводит итог прошедшего месяца
    и хвалит — только тех, у кого реально есть что отметить (0 квестов не
    повод для сообщения, это было бы похоже на упрёк, а не на похвалу)."""
    now = datetime.now()
    if now.month == 1:
        prev_year, prev_month = now.year - 1, 12
    else:
        prev_year, prev_month = now.year, now.month - 1
    month_name = RU_MONTHS.get(prev_month, "прошлый месяц")

    # Раньше здесь был фильтр profile IS NOT NULL, а profile никогда не
    # заполняется — итог не уходил никому. Берём всех, кто что-то закрыл.
    for user_id in get_users_with_completions(prev_year, prev_month):
        try:
            count = get_monthly_completed_count(user_id, prev_year, prev_month)
            if count <= 0:
                continue  # без упрёков — просто молчим, если месяц был пустым

            if count % 10 == 1 and count % 100 != 11:
                word = "квест"
            elif 2 <= count % 10 <= 4 and not (11 <= count % 100 <= 14):
                word = "квеста"
            else:
                word = "квестов"

            await bot.send_message(
                user_id,
                f"🎉 <b>Итоги месяца: {month_name}</b>\n\n"
                f"За {month_name} ты закрыл(а) {count} {word}. Это {count} раз, когда ты выбрал(а) сделать шаг, "
                "а не отложить — и это реально считается, даже если дни были обычными.\n\n"
                "Новый месяц — новый счёт. Погнали дальше?",
                parse_mode="HTML"
            )
        except Exception as e:
            print(f"Failed to send monthly recap to {user_id}: {e}")

@dp.message(Command("remind"))
async def set_reminder_time(message: Message):
    parts = message.text.split()
    if len(parts) != 2 or not parts[1].isdigit() or not (0 <= int(parts[1]) <= 23):
        await message.answer("Укажи час в формате: <code>/remind 9</code> (0–23, по твоему часовому поясу из мини-аппа).", parse_mode="HTML")
        return

    hour = int(parts[1])
    conn = connect()
    c = conn.cursor()
    c.execute("UPDATE users SET reminder_hour = ? WHERE user_id = ?", (hour, message.from_user.id))
    conn.commit()
    conn.close()
    await message.answer(f"Готово! Буду напоминать утром в {hour}:00 (по твоему времени).")

@dp.message(Command("evening"))
async def set_evening_reminder_time(message: Message):
    parts = message.text.split()
    if len(parts) != 2 or not parts[1].isdigit() or not (0 <= int(parts[1]) <= 23):
        await message.answer("Укажи час в формате: <code>/evening 20</code> (0–23, по твоему часовому поясу из мини-аппа).", parse_mode="HTML")
        return

    hour = int(parts[1])
    conn = connect()
    c = conn.cursor()
    c.execute("UPDATE users SET evening_reminder_hour = ? WHERE user_id = ?", (hour, message.from_user.id))
    conn.commit()
    conn.close()
    await message.answer(f"Готово! Буду спрашивать про день в {hour}:00 (по твоему времени).")

# ==================== ADMIN COMMANDS ====================
@dp.message(Command("stats"), F.from_user.id == ADMIN_ID)
async def admin_stats(message: Message):
    conn = connect()
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
    # HTTP API и статика мини-аппа — в этом же процессе (Railway: тип web, $PORT).
    await api.start_web(BOT_TOKEN, bot)

    # Ошибка сети на старте не должна ронять процесс: polling дальше сам
    # переподключается, а мини-апп продолжает работать.
    try:
        await bot.set_my_commands([
            BotCommand(command="start", description="🚀 Начать / открыть меню"),
            BotCommand(command="solo", description="🎯 Квест на одного"),
            BotCommand(command="board", description="🗺️ Карта недели"),
            BotCommand(command="habits", description="🌱 Трекер привычек"),
            BotCommand(command="myquests", description="📋 Мои квесты"),
            BotCommand(command="completed", description="🏆 Выполненные"),
            BotCommand(command="pair", description="💞 Квест для пары"),
            BotCommand(command="company", description="👥 Квест на компанию"),
            BotCommand(command="remind", description="⏰ Настроить утреннее напоминание"),
            BotCommand(command="evening", description="🌙 Настроить вечернее напоминание"),
        ])
    except Exception as e:
        print(f"Failed to set bot commands: {e}")

    if MINIAPP_URL:
        try:
            await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
                text="Открыть LifeQuest", web_app=WebAppInfo(url=MINIAPP_URL)))
        except Exception as e:
            print(f"Failed to set menu button: {e}")
    else:
        print("MINIAPP_URL не задан — новое приложение не будет открываться из бота")


    scheduler.add_job(send_daily_reminders, "cron", minute=0)
    scheduler.add_job(send_evening_reminders, "cron", minute=0)
    scheduler.add_job(send_monthly_recap, "cron", day=1, hour=10, minute=0)
    scheduler.add_job(send_plan_reminders, "interval", minutes=1)
    scheduler.add_job(cleanup_photos, "cron", hour=4, minute=17)
    photos.enabled()  # предупредит в логах, если Volume для фото не подключён
    scheduler.start()

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

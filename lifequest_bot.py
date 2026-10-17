# ============================================================
# LIFQUEST BOT — Telegram Bot Template (aiogram 3.x)
# ============================================================

import asyncio
import base64
import html
import json
import os
import random
from datetime import date, datetime, timedelta

from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, 
    InlineKeyboardButton, BotCommand, KeyboardButton, ReplyKeyboardMarkup,
    WebAppInfo, MenuButtonWebApp, LabeledPrice, PreCheckoutQuery, ReplyKeyboardRemove, BufferedInputFile
)
from apscheduler.events import EVENT_JOB_ERROR
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

load_dotenv()  # до импорта storage: он читает DB_PATH при загрузке

import api
import billing
import card
import challenges
import compliments
import contests
import duels
import friends
import game
import habits
import nudges
import ops
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
ops.setup(bot, ADMIN_ID)


# Любое действие человека в боте: запоминаем, что он здесь, и снимаем пометку
# «заблокировал бота» — значит, снова можно присылать напоминания.
async def _seen_middleware(handler, event, data):
    user = getattr(event, "from_user", None)
    if user:
        try:
            storage.mark_seen(user.id)
        except Exception as e:
            print(f"mark_seen failed: {e}")
    return await handler(event, data)

dp.message.outer_middleware(_seen_middleware)
dp.callback_query.outer_middleware(_seen_middleware)


async def safe_edit(message, text: str, **kwargs):
    """Редактирует сообщение. «Не изменилось» от Telegram — не ошибка: просто
    молча пропускаем (например, повторное нажатие той же кнопки)."""
    try:
        return await message.edit_text(text, **kwargs)
    except TelegramBadRequest as e:
        if "message is not modified" in str(e):
            return None
        raise


def _first_button_data(message) -> str:
    try:
        return message.reply_markup.inline_keyboard[0][0].callback_data or ""
    except (AttributeError, IndexError, TypeError):
        return ""


def fresh_variant(build, message, tries: int = 10):
    """Новый случайный вариант, отличный от уже показанного в сообщении —
    иначе «Поменять» иногда выдавал то же самое задание."""
    current = _first_button_data(message)
    text, kb = build()
    for _ in range(tries):
        if kb.inline_keyboard[0][0].callback_data != current:
            break
        text, kb = build()
    return text, kb


@dp.errors()
async def on_error(event):
    await ops.alert("обработчик бота", event.exception)
    return True

# ==================== KEYBOARD BUILDER ====================
# ==================== WELCOME ====================
WELCOME_TEXT = """👋 <b>Привет! Я LifeQuest.</b>

Подкидываю задания, после которых день перестаёт быть обычным: расследовать загадку, \
заговорить с незнакомцем, устроить свидание, которое никто не повторит.

Всё живёт в приложении 👇 — квесты, план дня, привычки, календарь, воспоминания и твой маскот.
А я буду присылать утром шутку и твою статистику, а вечером — спрашивать, как прошёл день."""

def build_start_menu_keyboard():
    """Только кнопка приложения: все задания и функции — в мини-аппе."""
    return InlineKeyboardMarkup(inline_keyboard=app_row()) if MINIAPP_URL else None

@dp.message(CommandStart())
async def cmd_start(message: Message):
    user_id = message.from_user.id
    is_new = not storage.get_user(user_id)
    ensure_user(user_id, message.from_user.username, message.from_user.first_name)
    invite = friends.parse_start((message.text or "").partition(" ")[2])
    if invite and invite[2] != user_id and storage.get_user(invite[2]):
        await handle_invite(message, invite, is_new)
        return
    await clear_old_keyboard(user_id)
    await message.answer(WELCOME_TEXT, parse_mode="HTML", reply_markup=build_start_menu_keyboard())


async def clear_old_keyboard(user_id: int):
    """Убираем старую клавиатуру «Карта недели» под полем ввода (один раз)."""
    if storage.get_user(user_id).get("kb_cleared"):
        return
    storage.update_user(user_id, kb_cleared=1)
    await ops.safe_send(user_id, "✨ Бот обновился: все задания и функции теперь в приложении LifeQuest.",
                        reply_markup=ReplyKeyboardRemove())


async def send_duel_messages(messages):
    """Сообщения вызовов: (user_id, text[, [(кнопка, callback), …]]) + кнопка приложения."""
    for m in messages or []:
        rows = [[InlineKeyboardButton(text=t, callback_data=c) for t, c in m[2]]] if len(m) > 2 and m[2] else []
        rows += app_row("friends")
        try:
            await ops.safe_send(m[0], m[1], parse_mode="HTML",
                                reply_markup=InlineKeyboardMarkup(inline_keyboard=rows) if rows else None)
        except Exception as e:
            await ops.alert("duel message", e, f"user {m[0]}")


async def handle_duel_link(message: Message, duel_id: int, inviter_id: int, is_new: bool):
    """Пришли по ссылке на вызов: дружим и сразу принимаем вызов."""
    user_id = message.from_user.id
    res = friends.handle_join(user_id, inviter_id, is_new)
    gift = "\n\n🧊 В подарок — по заморозке серии вам обоим." if res.get("gift") else ""
    try:
        result = duels.accept(user_id, duel_id)
    except game.QuestError as e:
        await message.answer(f"{html.escape(str(e))}{gift}", parse_mode="HTML", reply_markup=build_start_menu_keyboard())
        return
    d = result["duel"]
    await message.answer(
        f"⚔️ <b>Вызов принят!</b>\n\n{html.escape(d['emoji'] or '')} <b>{html.escape(d['title'])}</b> — "
        f"{duels.mode_text(d['mode'], d['days'])}.\nПривычка уже в твоём списке — отмечай её каждый день.{gift}",
        parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=app_row("friends")) if MINIAPP_URL else None)
    await send_duel_messages(result["messages"])


async def handle_contest_link(message: Message, contest_id: int, inviter_id: int, is_new: bool):
    """Пришли по ссылке на соревнование: дружим с создателем и заходим в лобби."""
    user_id = message.from_user.id
    res = friends.handle_join(user_id, inviter_id, is_new)
    gift = "\n\n🧊 В подарок — по заморозке серии вам обоим." if res.get("gift") else ""
    open_app = InlineKeyboardMarkup(inline_keyboard=[[build_miniapp_button("🏆 Открыть соревнование", "friends")]]) \
        if MINIAPP_URL else None
    try:
        result = contests.join(user_id, contest_id)
    except game.QuestError as e:
        await message.answer(f"{html.escape(str(e))}{gift}", parse_mode="HTML", reply_markup=build_start_menu_keyboard())
        return
    c = result["contest"]
    title = f"{html.escape(c['emoji'] or '🏆')} <b>{html.escape(c['title'])}</b>"
    if result.get("already"):
        await message.answer(f"Ты уже в соревновании {title} 🙂", parse_mode="HTML", reply_markup=open_app)
        return
    status = ("Сейчас создатель настраивает правила — можешь предложить свой пункт. "
              "Как только соревнование запустят, придёт сообщение." if c["status"] == "lobby" else "")
    await message.answer(
        f"🏆 <b>Ты в лобби!</b>\n\n{title} — {c['days']} дн., участников: {c['members_count']}.\n{status}{gift}",
        parse_mode="HTML", reply_markup=open_app)
    await send_duel_messages(result["messages"])

async def handle_invite(message: Message, invite, is_new: bool):
    """Пришли по ссылке друга: дружим, дарим заморозки новичку и пригласившему,
    а если звали на конкретный квест — сразу кладём его в «Мои квесты»."""
    kind, quest_id, inviter_id = invite
    if kind == "d":
        await handle_duel_link(message, quest_id, inviter_id, is_new)
        return
    if kind == "c":
        await handle_contest_link(message, quest_id, inviter_id, is_new)
        return
    user_id = message.from_user.id
    res = friends.handle_join(user_id, inviter_id, is_new)
    inviter = storage.get_user(inviter_id)
    inviter_name = html.escape(inviter.get("first_name") or inviter.get("username") or "Друг")
    me = html.escape(message.from_user.first_name or "Друг")
    gift = "\n\n🧊 В подарок — по заморозке серии вам обоим." if res.get("gift") else ""
    if kind == "q":
        game.accept_quest(user_id, quest_id)
        q = game.CATALOG[quest_id]
        text = (f"👋 <b>{inviter_name} зовёт тебя на квест!</b>\n\n{html.escape(q['emoji'])} "
                f"<b>{html.escape(q['title'])}</b>\n{html.escape(q['text'])}\n\nОн уже в «Моих квестах». "
                f"Выполните вместе — или наперегонки.{gift}")
        note = f"🎯 {me} принимает твой вызов: «{html.escape(q['title'])}»!"
    else:
        text = f"👋 <b>{inviter_name} зовёт тебя в LifeQuest</b> — теперь вы друзья.{gift}"
        note = f"🎉 {me} теперь в LifeQuest по твоей ссылке!"
    await message.answer(WELCOME_TEXT if kind == "ref" else text, parse_mode="HTML",
                         reply_markup=build_start_menu_keyboard() if kind == "ref" else
                         InlineKeyboardMarkup(inline_keyboard=app_row("quests")) if MINIAPP_URL else None)
    if kind == "ref":
        await message.answer(text, parse_mode="HTML")
    if res.get("added") or res.get("gift"):
        await ops.safe_send(inviter_id, note + ("\n🧊 +1 заморозка серии в подарок." if res.get("gift") else ""),
                            parse_mode="HTML")


# ==================== ВСЁ — В МИНИ-АППЕ ====================
# Задания, «Мои квесты», карта недели и привычки живут только в приложении.
# Старые команды и кнопки из прошлых сообщений ведут туда.
APP_ONLY_COMMANDS = {"solo": "quests", "pair": "quests", "company": "quests", "myquests": "quests",
                     "completed": "progress", "board": "board", "habits": "habits"}


@dp.message(Command(*APP_ONLY_COMMANDS))
async def cmd_app_only(message: Message):
    ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    cmd = (message.text or "").split()[0].lstrip("/").split("@")[0]
    if not MINIAPP_URL:
        await message.answer("Это теперь в приложении LifeQuest — оно скоро откроется.")
        return
    await message.answer("✨ Это теперь в приложении — там удобнее:",
                         reply_markup=InlineKeyboardMarkup(inline_keyboard=app_row(APP_ONLY_COMMANDS.get(cmd, ""))))


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

def app_row(section: str = "") -> list:
    """Нижняя строка кнопок любого напоминания: зайти в приложение."""
    return [[build_miniapp_button("✨ Открыть LifeQuest", section)]] if MINIAPP_URL else []

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
            "🎯 <b>Цели месяца</b>\n\n"
            "Впиши 9 своих целей на месяц, отмечай выполненное и собирай линии — "
            "за каждую линию и полную карту начисляется XP.",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [build_miniapp_button("🎯 Открыть цели месяца", "board")]
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
        text = "🎉 <b>Бинго! Цели месяца закрыты полностью.</b>"
        if board["reward"].strip():
            text += f"\n\nТвоя награда: {html.escape(board['reward'])} — она честно заработана!"
    else:
        text = f"✅ Цели месяца сохранены. Выполнено {done} из {BOARD_CELLS}."
    if result["xp"]:
        text += f"\n+{result['xp']} XP"

    if MINIAPP_URL:
        # Старая карта больше не нужна — убираем её клавиатуру, дальше всё в приложении.
        await message.answer(text, parse_mode="HTML", reply_markup=ReplyKeyboardRemove())
        await message.answer("Цели месяца теперь живут в приложении — в разделе «Календарь» 👇",
                             reply_markup=InlineKeyboardMarkup(inline_keyboard=[[build_miniapp_button("🗺️ Открыть карту", "board")]]))
    else:
        await message.answer(text, parse_mode="HTML", reply_markup=build_board_keyboard(user_id))

# ==================== DAILY REMINDERS ====================
def users_at_local_hour(column: str, default_hour: int) -> list:
    """user_id тех, у кого сейчас по их часовому поясу наступил нужный час."""
    conn = connect(rows=True)
    rows = conn.execute(f"SELECT user_id, tz, COALESCE({column}, ?) AS hour FROM users WHERE COALESCE(blocked, 0) = 0",
                        (default_hour,)).fetchall()
    conn.close()
    return [r["user_id"] for r in rows if game.local_now(dict(r)).hour == r["hour"]]

def build_morning_message(user_id: int):
    """Утро: шутка маскота + статистика (подпись к картинке-карточке). Без кнопок с заданиями."""
    user = storage.get_user(user_id)
    today = game.local_today(user)
    ctx = nudges.context(user_id)
    if ctx["away"] >= 3:
        joke = nudges.pick("absent", user_id, today, m=ctx["m"], days=ctx["away"])
    else:
        joke = nudges.pick("morning", user_id, today, m=ctx["m"])
    s = ctx["streak"]
    lv = game.level_info(user.get("xp") or 0)
    hb = habits.summary(user_id)
    today_plans = plans.today_plans(user_id)
    week = game.week_summary(user_id, today)

    if s["status"] in ("done", "at_risk", "freeze") and s["current"]:
        streak = f"{s['current']} {plural_ru(s['current'], 'день', 'дня', 'дней')}"
        if s["status"] == "freeze":
            streak += " — вчера выручила заморозка ❄️"
    elif s["status"] == "lost":
        streak = f"прервалась на {s['lost_value']} — начнём новую?"
    else:
        streak = "начни сегодня — отметь привычку"
    lines = [f"🌅 <b>Доброе утро!</b>\n{joke}", "", "📊 <b>Твоя статистика</b>",
             f"🔥 Серия: {streak}",
             f"🌱 Привычки на сегодня: {hb['total']}" if hb["total"] else "🌱 Привычек пока нет — заведи первую в приложении",
             f"🗓️ Планов на сегодня: {len(today_plans)}",
             f"✅ За неделю: {week['done']} {plural_ru(week['done'], 'квест', 'квеста', 'квестов')}"
             + (f", привычки на {week['habits_pct']}%" if week.get("habits_pct") is not None else ""),
             f"⭐ Уровень {lv['level']} «{html.escape(lv['name'])}» — до следующего {lv['next'] - lv['xp']} XP"]
    text = "\n".join(lines)

    rows = []
    lost = billing.restore_offer(user, today) if game.PAYMENTS_ENABLED else 0
    if lost:
        text += (f"\n\n💔 Серия {lost} {plural_ru(lost, 'день', 'дня', 'дней')} прервалась. "
                 "Её ещё можно вернуть — пока не начата новая.")
        rows.append([InlineKeyboardButton(text=f"🔥 Вернуть серию за {billing.price(user_id, 'streak_restore')}⭐",
                                          callback_data="pay_streak_restore")])
    rows += app_row()
    return text, (InlineKeyboardMarkup(inline_keyboard=rows) if rows else None)


async def send_owner_compliment():
    """Каждый час: владелице бота (ADMIN_ID) — утренний комплимент в её час
    (COMPLIMENT_HOUR, по умолчанию 8 по её часовому поясу). Больше никому."""
    if not ADMIN_ID:
        return
    user = storage.get_user(ADMIN_ID)
    if not user:
        return
    now = game.local_now(user)
    today = now.date().isoformat()
    if now.hour != int(os.getenv("COMPLIMENT_HOUR", "8")) or user.get("compliment_day") == today:
        return
    storage.update_user(ADMIN_ID, compliment_day=today)
    try:
        await ops.safe_send(ADMIN_ID, compliments.for_day(now.date().toordinal()))
    except Exception as e:
        await ops.alert("compliment", e)


async def send_daily_reminders():
    """Каждый час: тем, у кого сейчас час утреннего напоминания (/remind), —
    карточка с маскотом, шутка и статистика; затем планы на сегодня."""
    me = None
    for user_id in users_at_local_hour("reminder_hour", 9):
        try:
            await clear_old_keyboard(user_id)
            text, kb = build_morning_message(user_id)
            if me is None:
                try:
                    me = (await bot.get_me()).username
                except Exception:
                    me = ""
            try:
                photo = card.render(user_id, me or None)
            except Exception as e:  # без картинки — всё равно пришлём текст
                await ops.alert("morning card", e, f"user {user_id}")
                photo = None
            if photo:
                await ops.safe_send_photo(user_id, BufferedInputFile(photo, filename="lifequest.jpg"),
                                          caption=text, parse_mode="HTML", reply_markup=kb)
            else:
                await ops.safe_send(user_id, text, parse_mode="HTML", reply_markup=kb)
            await send_morning_plans(user_id)
        except Exception as e:
            await ops.alert("reminder", e, f"user {user_id}")


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
    """Утренняя сводка: главное дело, планы по времени и привычки дня
    (если включена в профиле и есть что показать). Без кнопок — только «Открыть LifeQuest»."""
    user = storage.get_user(user_id)
    if not user.get("morning_plans", 1):
        return
    items = sorted(plans.today_plans(user_id), key=lambda o: o.get("time") or "99")
    hb = [h for h in habits.habits_view(user_id) if h["kind"] == "build" and h["due_today"] and not h["done_today"]]
    if not items and not hb:
        return
    ctx = nudges.context(user_id)
    lines = []
    focus = next((o for o in items if o.get("focus")), None)
    if focus:
        lines.append(f"🎯 <b>Главное сегодня:</b> {html.escape(focus['title'])}")
    if items:
        head = nudges.pick("plans_today", user_id, ctx["today"], m=ctx["m"])
        lines.append(f"🗓️ <b>Сегодня у тебя в планах</b>\n{head}\n\n" + plans_lines(items))
    if hb:
        lines.append("🌱 <b>Привычки на сегодня:</b> " + ", ".join(f"{h['emoji']} {html.escape(h['title'])}" for h in hb))
    rows = app_row("calendar") if MINIAPP_URL else []
    await ops.safe_send(user_id, "\n\n".join(lines), parse_mode="HTML",
                        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows) if rows else None)


def _drop_button(markup, data: str):
    """Убирает из клавиатуры строку с нажатой кнопкой (или саму кнопку)."""
    if not markup:
        return None
    rows = []
    for row in markup.inline_keyboard:
        if any(b.callback_data == data for b in row):
            rest = [b for b in row if b.callback_data != data] if data.startswith("hd:") else []
            if rest:
                rows.append(rest)
            continue
        rows.append(row)
    return InlineKeyboardMarkup(inline_keyboard=rows) if rows else None


async def send_plan_reminders():
    """Каждую минуту: напоминания по планам — в назначенное время или за час
    (по часовому поясу пользователя). Каждое — один раз."""
    for user_id, o in plans.due_reminders():
        plans.mark_reminded(o["id"], o["date"])
        try:
            emoji = o["quest"]["emoji"] if o.get("quest") else "📝"
            head = "⏰ <b>Через час по плану</b>" if o["remind"] == "hour_before" else "⏰ <b>Сейчас по плану</b>"
            ctx = nudges.context(user_id)
            joke = nudges.pick("plan_hour" if o["remind"] == "hour_before" else "plan_now", user_id, ctx["today"],
                               m=ctx["m"], plan=o["title"][:60])
            text = f"{head}\n{joke}\n\n{html.escape(emoji)} {html.escape(o['title'])} — в {o['time']}"
            if o.get("note"):
                text += f"\n<i>{html.escape(o['note'][:200])}</i>"
            markup = InlineKeyboardMarkup(inline_keyboard=app_row("calendar")) if MINIAPP_URL else None
            await ops.safe_send(user_id, text, parse_mode="HTML", reply_markup=markup)
        except Exception as e:
            await ops.alert("plan reminder", e, f"user {user_id}")


async def send_habit_reminders():
    """Каждую минуту: личные напоминания привычек (по времени пользователя)."""
    for user_id, h in habits.due_reminders():
        habits.mark_reminded(h["id"], game.local_today(storage.get_user(user_id)).isoformat())
        try:
            progress = f" ({h['today']}/{h['target']}{(' ' + h['unit']) if h['unit'] else ''})" if h["target"] > 1 else ""
            streak = f"\n🔥 Серия: {h['streak']} {plural_ru(h['streak'], 'день', 'дня', 'дней')} — не дай ей прерваться!" \
                if h["streak"] >= 2 and h["streak_unit"] == "day" else ""
            text = f"🌱 <b>Время привычки</b>\n{html.escape(h['emoji'])} {html.escape(h['title'])}{html.escape(progress)}{streak}"
            markup = InlineKeyboardMarkup(inline_keyboard=app_row("habits")) if MINIAPP_URL else None
            await ops.safe_send(user_id, text, parse_mode="HTML", reply_markup=markup)
        except Exception as e:
            await ops.alert("habit reminder", e, f"user {user_id}")


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
            text, markup = build_evening_message(user_id)
            await ops.safe_send(user_id, text, parse_mode="HTML", reply_markup=markup)
            if game.local_today(storage.get_user(user_id)).weekday() == 6:  # воскресенье — итоги недели
                weekly, weekly_kb = build_weekly_message(user_id)
                if weekly:
                    await ops.safe_send(user_id, weekly, parse_mode="HTML", reply_markup=weekly_kb)
        except Exception as e:
            await ops.alert("evening reminder", e, f"user {user_id}")


def plural_ru(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def build_weekly_message(user_id: int):
    """Итоги недели (воскресенье, час вечернего напоминания). None — если
    и эта, и прошлая неделя пустые: не тревожим тех, кто давно не заходит."""
    ctx = nudges.context(user_id)
    w = game.week_summary(user_id, ctx["today"])
    if not w["done"] and not w["prev_done"] and not w["habits_pct"]:
        return None, None
    kind = "week_zero" if not w["done"] else "week_up" if w["done"] > w["prev_done"] else "week_ok"
    joke = nudges.pick(kind, user_id, ctx["today"], m=ctx["m"])
    lines = [f"📊 <b>Итоги недели</b>\n{joke}\n"]
    trend = ""
    if w["prev_done"]:
        diff = w["done"] - w["prev_done"]
        trend = f" ({'+' if diff > 0 else ''}{diff} к прошлой)" if diff else " (как на прошлой)"
    lines.append(f"✅ Квестов: <b>{w['done']}</b>{trend}")
    if w["xp"]:
        lines.append(f"⭐ Заработано: <b>{w['xp']} XP</b>")
    if w["best_day"]:
        lines.append(f"🏆 Лучший день: {w['best_day']} — {w['best_count']} {plural_ru(w['best_count'], 'квест', 'квеста', 'квестов')}")
    if w["active_days"]:
        lines.append(f"📅 Активных дней: {w['active_days']} из 7")
    if w["streak"]:
        lines.append(f"🔥 Серия: {w['streak']} {plural_ru(w['streak'], 'день', 'дня', 'дней')}")
    if w["habits_pct"] is not None:
        lines.append(f"🌱 Привычки выполнены на {w['habits_pct']}%")
    try:
        league = friends.list_view(user_id)
    except Exception:
        league = {"friends": []}
    if league["friends"]:
        mine = league["me"]["points"]
        place = 1 + sum(1 for f in league["friends"] if f["points"] > mine)
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(place, "🏅")
        lines.append(f"{medal} Лига друзей: {place} место из {len(league['friends']) + 1} — {mine} "
                     f"{plural_ru(mine, 'очко', 'очка', 'очков')}")
    markup = InlineKeyboardMarkup(inline_keyboard=app_row("progress")) if MINIAPP_URL else None
    return "\n".join(lines), markup


def build_evening_message(user_id: int):
    """Вечер: что сделано за день + шутка маскота (с драмой, если серия под угрозой)."""
    today_texts = get_completed_today(user_id)
    ctx = nudges.context(user_id)
    if today_texts:
        joke = nudges.pick("evening_done", user_id, ctx["today"], m=ctx["m"])
        lines = [f"🌙 <b>Как прошёл день?</b>\n{joke}\n\nСегодня отмечено:"]
        lines.extend(f"✅ {t}" for t in today_texts)
        text = "\n".join(lines)
    else:
        streak = ctx["streak"]
        if streak["status"] in ("at_risk", "freeze") and streak["current"] > 0:
            joke = nudges.pick("evening_streak", user_id, ctx["today"], m=ctx["m"],
                               streak=streak["current"], hours=ctx["hours"])
        else:
            joke = nudges.pick("evening_none", user_id, ctx["today"], m=ctx["m"], hours=ctx["hours"])
        text = f"🌙 <b>Как прошёл день?</b>\n\n{joke}"

    ch = challenges.summary(user_id)
    if ch and not ch["today_done"]:
        need = f"квест из сферы «{ch['sphere']}»" if ch["sphere"] else "любой квест"
        text += (f"\n\n{ch['emoji']} <b>{html.escape(ch['title'])}</b>: день {ch['day']} из {ch['days']} "
                 f"ещё не засчитан — нужен {need}.")
    rows = []
    habits_block = habits.evening_text(user_id)
    if habits_block:
        text += "\n\n" + habits_block
        if MINIAPP_URL and "▫️" in habits_block:
            rows.append([build_miniapp_button("🌱 Отметить привычки", "habits")])
    rows += app_row()
    return text, (InlineKeyboardMarkup(inline_keyboard=rows) if rows else None)

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

            await ops.safe_send(
                user_id,
                f"🎉 <b>Итоги месяца: {month_name}</b>\n\n"
                f"В копилке за {month_name}: {count} {word}. Это {count} раз, когда выбор был в пользу шага, "
                "а не отложить — и это реально считается, даже если дни были обычными.\n\n"
                "Новый месяц — новый счёт. Погнали дальше?",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=app_row("progress")) if MINIAPP_URL else None,
            )
        except Exception as e:
            await ops.alert("monthly recap", e, f"user {user_id}")

@dp.message(Command("remind"))
async def set_reminder_time(message: Message):
    parts = message.text.split()
    if len(parts) != 2 or not parts[1].isdigit() or not (0 <= int(parts[1]) <= 23):
        await message.answer("Укажи час в формате: <code>/remind 9</code> (0–23, по твоему часовому поясу из мини-аппа).", parse_mode="HTML")
        return

    hour = int(parts[1])
    ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
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
    ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
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
    c.execute("SELECT COUNT(*) FROM users WHERE COALESCE(blocked, 0) = 1")
    blocked_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM users WHERE premium_interest_at IS NOT NULL")
    premium_interest = c.fetchone()[0]
    prem = billing.stats()
    conn.close()

    await message.answer(
        f"📊 <b>Статистика</b>\n\n"
        f"Пользователей: {users_count} (заблокировали бота: {blocked_count})\n"
        f"Выполнено заданий: {tasks_count}\n"
        f"Средняя неделя: {avg_week:.1f}\n"
        f"Средний стрик: {avg_streak:.1f} дней\n"
        f"Нажали «Хочу Premium»: {premium_interest}\n"
        f"Premium сейчас: {prem['active']} · пробных недель: {prem['trials']}\n"
        f"Оплат: {prem['payments']} на {prem['stars']}⭐ (за 30 дней: {prem['stars_30d']}⭐)\n"
        f"Оплата: {'включена' if game.PAYMENTS_ENABLED else 'выключена'}",
        parse_mode="HTML"
    )

@dp.message(Command("compliment"), F.from_user.id == ADMIN_ID)
async def admin_compliment(message: Message):
    """Комплимент прямо сейчас — только владелице бота."""
    await message.answer(compliments.for_day(random.randrange(10000)))


@dp.message(Command("backup"), F.from_user.id == ADMIN_ID)
async def admin_backup(message: Message):
    await message.answer("💾 Делаю копию базы…")
    if not await ops.send_backup(message.chat.id):
        await message.answer("Не получилось — подробности придут отдельным сообщением или есть в логах.")


# ==================== PREMIUM ====================
STREAK_PUSH_HOUR = 22  # по местному времени: за 2 часа до полуночи
STREAK_PUSH_MIN = 3    # тревожим, только если серия уже чего-то стоит


def build_streak_alarm(user_id: int):
    """«Серия сгорит в полночь» — только когда её правда нечем спасти:
    сегодня ещё ничего, а недельные и купленные заморозки закончились."""
    user = storage.get_user(user_id)
    today = game.local_today(user)
    s = game.user_streak(user, today)
    if s["status"] != "at_risk" or s["current"] < STREAK_PUSH_MIN:
        return None, None
    if s["freeze_weekly_left"] or s["freeze_tokens"]:
        return None, None
    if user.get("streak_push_date") == today.isoformat():
        return None, None
    n = s["current"]
    text = (f"🔥 <b>Серия {n} {plural_ru(n, 'день', 'дня', 'дней')} сгорит в полночь!</b>\n\n"
            "Заморозок не осталось — спасёт только одна привычка, отмеченная сегодня. "
            "Даже стакан воды считается 💧")
    rows = [[build_miniapp_button("🌱 Отметить привычку", "habits")]] if MINIAPP_URL else []
    if game.PAYMENTS_ENABLED:
        rows.append([InlineKeyboardButton(text=f"🧊 Заморозка за {billing.price(user_id, 'freeze')}⭐",
                                          callback_data="pay_freeze")])
    elif game.balance(user) >= game.FREEZE_PRICE:
        rows.append([InlineKeyboardButton(text=f"🧊 Заморозка за {game.FREEZE_PRICE} XP",
                                          callback_data="xp_freeze")])
    rows += app_row()
    return text, InlineKeyboardMarkup(inline_keyboard=rows)


async def send_streak_alarms():
    for user_id in users_at_local_hour(f"{STREAK_PUSH_HOUR}", STREAK_PUSH_HOUR):
        try:
            text, kb = build_streak_alarm(user_id)
            if text:
                today = game.local_today(storage.get_user(user_id)).isoformat()
                storage.update_user(user_id, streak_push_date=today)
                await ops.safe_send(user_id, text, parse_mode="HTML", reply_markup=kb)
        except Exception as e:
            await ops.alert("streak alarm", e, f"user {user_id}")


@dp.callback_query(F.data.regexp(r"^p[dt]:\d+:\d{4}-\d{2}-\d{2}$"))
async def morning_plan_button(callback: CallbackQuery):
    kind, plan_id, day = callback.data.split(":")
    uid = callback.from_user.id
    try:
        if kind == "pd":
            plans.complete_plan(uid, int(plan_id), day)
            note = "✅ Готово! Так держать"
        else:
            tomorrow = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
            plans.move_plan(uid, int(plan_id), day, tomorrow)
            note = "➡️ Перенесено на завтра — без чувства вины 🌿"
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    await callback.answer(note)
    try:
        await callback.message.edit_reply_markup(reply_markup=_drop_button(callback.message.reply_markup, callback.data))
    except Exception:
        pass


@dp.callback_query(F.data.regexp(r"^hd:\d+$"))
async def morning_habit_button(callback: CallbackQuery):
    uid = callback.from_user.id
    try:
        hb = habits.habit_view(uid, int(callback.data[3:]))
        res = habits.log_habit(uid, hb["id"], count=hb["target"])
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    xp = f" · +{res['xp']} XP" if res.get("xp") else ""
    await callback.answer(f"{hb['emoji']} {hb['title']} — сделано!{xp}")
    if res.get("just_done"):
        await send_duel_messages(duels.on_habit_done(uid, hb["id"]))
    try:
        await callback.message.edit_reply_markup(reply_markup=_drop_button(callback.message.reply_markup, callback.data))
    except Exception:
        pass


@dp.callback_query(F.data.regexp(r"^du:[ad]:\d+$"))
async def duel_button(callback: CallbackQuery):
    """Кнопки «Принимаю» / «Не сейчас» под приглашением на вызов."""
    uid = callback.from_user.id
    _, action, duel_id = callback.data.split(":")
    try:
        result = duels.accept(uid, int(duel_id)) if action == "a" else duels.decline(uid, int(duel_id))
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    try:
        await callback.message.edit_reply_markup(reply_markup=InlineKeyboardMarkup(inline_keyboard=app_row("friends"))
                                                 if MINIAPP_URL else None)
    except Exception:
        pass
    if action == "a":
        await callback.answer("Вызов принят! Привычка уже в твоём списке 💪", show_alert=True)
    else:
        await callback.answer("Хорошо, в другой раз")
    await send_duel_messages(result.get("messages"))


async def send_duel_updates():
    """Каждый час: итоги закончившихся вызовов и вечерние напоминания."""
    try:
        await send_duel_messages(duels.finalize_due())
        await send_duel_messages(duels.evening_alerts())
    except Exception as e:
        await ops.alert("duels", e)


async def send_contest_updates():
    """Каждый час: итоги соревнований, таймаут лобби и вечерние напоминания."""
    try:
        await send_duel_messages(contests.finalize_due())
        await send_duel_messages(contests.lobby_timeouts())
        await send_duel_messages(contests.evening_alerts())
    except Exception as e:
        await ops.alert("contests", e)


@dp.callback_query(F.data == "xp_freeze")
async def xp_freeze(callback: CallbackQuery):
    try:
        game.buy(callback.from_user.id, "freeze")
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    await callback.answer("🧊 Заморозка в запасе — серия спасена!", show_alert=True)


def premium_text(user_id: int) -> str:
    user = storage.get_user(user_id)
    view = billing.premium_view(user)
    perks = ("🐼 Все маскоты сразу, без ожидания уровня\n🎲 Безлимит «Другое»\n📸 Больше фото на доске воспоминаний\n"
             "❄️ +1 бесплатная заморозка в неделю\n🎩 Эксклюзивные аксессуары и стиль «Космос»\n"
             "🗂️ Тематические наборы квестов\n✨ 30 ИИ-квестов под настроение в день\n"
             "🏆 Челлендж на 30 дней и итоги года")
    if view["forever"]:
        head = "👑 <b>Premium навсегда.</b> Спасибо, что ты с нами!"
    elif view["active"]:
        head = f"👑 <b>Premium активен</b> до {view['until'][:10]} (UTC)."
    else:
        head = "👑 <b>LifeQuest Premium</b>"
    return f"{head}\n\n{perks}"


def premium_keyboard(user_id: int) -> InlineKeyboardMarkup:
    user = storage.get_user(user_id)
    view = billing.premium_view(user)
    rows = []
    if view["trial_available"]:
        rows.append([InlineKeyboardButton(text=f"🎁 {view['trial_days']} дней бесплатно", callback_data="premium_trial")])
    if game.PAYMENTS_ENABLED and not view["forever"]:
        p = view["prices"]
        month = f"{p['premium_month']}⭐" + (" (−50%)" if p["premium_month"] < view["full_prices"]["premium_month"] else "")
        rows.append([InlineKeyboardButton(text=f"30 дней — {month}", callback_data="pay_premium_month")])
        rows.append([InlineKeyboardButton(text=f"Год — {p['premium_year']}⭐", callback_data="pay_premium_year")])
    rows += app_row("premium")
    return InlineKeyboardMarkup(inline_keyboard=rows)


@dp.message(Command("premium"))
async def cmd_premium(message: Message):
    ensure_user(message.from_user.id, message.from_user.username, message.from_user.first_name)
    text = premium_text(message.from_user.id)
    if not game.PAYMENTS_ENABLED and not game.is_premium(storage.get_user(message.from_user.id)):
        text += "\n\n<i>Оплата скоро появится.</i>"
    await message.answer(text, parse_mode="HTML", reply_markup=premium_keyboard(message.from_user.id))


@dp.callback_query(F.data == "premium_trial")
async def premium_trial(callback: CallbackQuery):
    try:
        until = billing.start_trial(callback.from_user.id)
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    await callback.answer()
    await callback.message.answer(f"🎁 <b>Premium включён на {billing.TRIAL_DAYS} дней</b> — до {until[:10]}.\n"
                                  "Загляни в магазин: там тебя ждут новые аксессуары и стиль «Космос» ✨",
                                  parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=app_row("shop")))


@dp.callback_query(F.data.startswith("pay_"))
async def pay_product(callback: CallbackQuery):
    product = callback.data[len("pay_"):]
    try:
        p = billing.invoice_params(callback.from_user.id, product)
    except game.QuestError as e:
        await callback.answer(str(e), show_alert=True)
        return
    await callback.answer()
    await bot.send_invoice(callback.from_user.id, title=p["title"], description=p["description"],
                           payload=p["payload"], provider_token="", currency=p["currency"],
                           prices=[LabeledPrice(label=p["title"], amount=p["stars"])])


@dp.pre_checkout_query()
async def on_pre_checkout(query: PreCheckoutQuery):
    try:
        billing.validate_checkout(query.from_user.id, query.invoice_payload, query.total_amount, query.currency)
    except game.QuestError as e:
        await query.answer(ok=False, error_message=str(e))
        return
    await query.answer(ok=True)


PAID_TEXT = {
    "premium_month": "👑 <b>Premium активен</b> до {until}. Спасибо, что поддерживаешь LifeQuest! 💛",
    "premium_year": "👑 <b>Premium на год</b> — до {until}. Спасибо, что ты с нами 💛",
    "freeze": "🧊 <b>Заморозка в запасе</b> — серия под защитой.",
    "streak_restore": "🔥 <b>Серия возвращена: {streak} дн.</b> Сделай сегодня одно дело, чтобы она продолжилась!",
}


@dp.message(F.successful_payment)
async def on_successful_payment(message: Message):
    sp = message.successful_payment
    try:
        res = billing.apply_payment(message.from_user.id, sp.invoice_payload,
                                    sp.telegram_payment_charge_id, sp.total_amount)
    except Exception as e:
        await ops.alert("payment", e, f"user {message.from_user.id} charge {sp.telegram_payment_charge_id}")
        await message.answer("Оплата прошла, но что-то пошло не так при начислении — мы уже разбираемся. "
                             "Напиши /paysupport, если не дождёшься.")
        return
    if res["duplicate"]:
        return
    if res.get("compensation"):
        text = "Серию успели начать заново, поэтому вместо возврата — 🧊🧊 две заморозки в запас."
    else:
        text = PAID_TEXT[res["product"]].format(until=(res.get("until") or "")[:10], streak=res.get("streak"))
    await message.answer(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(inline_keyboard=app_row()))


@dp.message(Command("paysupport"))
async def cmd_paysupport(message: Message):
    await message.answer("💬 Вопрос по оплате? Опиши, что случилось, одним сообщением после команды "
                         "<code>/paysupport</code> — ответим и, если нужно, вернём звёзды.", parse_mode="HTML")
    text = (message.text or "").partition(" ")[2].strip()
    if text and ADMIN_ID:
        await ops.safe_send(ADMIN_ID, f"💬 paysupport от {message.from_user.id} (@{message.from_user.username}):\n"
                                      f"{html.escape(text)}")


PREMIUM_NOTICE = {
    "soon": "⏳ <b>Premium закончится через 2 дня.</b> Безлимит, заморозки и «Космос» пропадут — продлим?",
    "ended": "🌙 <b>Premium закончился.</b> Всё сделанное остаётся с тобой. Вернуть Premium можно в любой момент.",
}


async def send_premium_notices():
    for user_id, kind, until in billing.users_for_premium_notice():
        try:
            billing.mark_notice(user_id, kind, until)
            await ops.safe_send(user_id, PREMIUM_NOTICE[kind], parse_mode="HTML", reply_markup=premium_keyboard(user_id))
        except Exception as e:
            await ops.alert("premium notice", e, f"user {user_id}")


@dp.message(Command("grant"), F.from_user.id == ADMIN_ID)
async def admin_grant(message: Message):
    parts = (message.text or "").split()
    if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit():
        await message.answer("Формат: <code>/grant user_id дней</code>", parse_mode="HTML")
        return
    until = billing.grant(int(parts[1]), int(parts[2]))
    await message.answer(f"👑 Premium для {parts[1]} до {until[:10]}")


@dp.message(Command("refund"), F.from_user.id == ADMIN_ID)
async def admin_refund(message: Message):
    parts = (message.text or "").split()
    if len(parts) != 2:
        await message.answer("Формат: <code>/refund charge_id</code>", parse_mode="HTML")
        return
    try:
        row = billing.mark_refunded(parts[1])
        await bot.refund_star_payment(user_id=row["user_id"], telegram_payment_charge_id=parts[1])
    except Exception as e:
        await message.answer(f"Не получилось: {html.escape(str(e))}")
        return
    await message.answer(f"↩️ Возвращено {row['stars']}⭐ пользователю {row['user_id']}")


# Регистрируется последним: сюда попадают только кнопки, которых больше нет.
@dp.callback_query()
async def old_buttons(callback: CallbackQuery):
    """Кнопки из старых сообщений (задания, «Мои квесты», карта) — теперь всё в приложении."""
    await callback.answer("Задания теперь живут в приложении — нажми «Открыть LifeQuest» ✨", show_alert=True)


def _on_job_error(event):
    if event.exception:
        asyncio.get_event_loop().create_task(ops.alert(f"задача по расписанию {event.job_id}", event.exception))

# ==================== MAIN ====================
async def main():
    # HTTP API и статика мини-аппа — в этом же процессе (Railway: тип web, $PORT).
    await api.start_web(BOT_TOKEN, bot)

    # Ошибка сети на старте не должна ронять процесс: polling дальше сам
    # переподключается, а мини-апп продолжает работать.
    try:
        await bot.set_my_commands([
            BotCommand(command="start", description="✨ Открыть LifeQuest"),
            BotCommand(command="remind", description="⏰ Час утреннего напоминания"),
            BotCommand(command="evening", description="🌙 Час вечернего вопроса"),
            BotCommand(command="premium", description="👑 LifeQuest Premium"),
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
    scheduler.add_job(send_owner_compliment, "cron", minute=0, second=30)
    scheduler.add_job(send_duel_updates, "cron", minute=3)
    scheduler.add_job(send_contest_updates, "cron", minute=4)
    scheduler.add_job(send_evening_reminders, "cron", minute=0)
    scheduler.add_job(send_monthly_recap, "cron", day=1, hour=10, minute=0)
    scheduler.add_job(send_plan_reminders, "interval", minutes=1)
    scheduler.add_job(send_habit_reminders, "interval", minutes=1)
    scheduler.add_job(send_streak_alarms, "cron", minute=1)
    scheduler.add_job(send_premium_notices, "cron", minute=7)
    scheduler.add_job(cleanup_photos, "cron", hour=4, minute=17)
    scheduler.add_job(ops.send_backup, "cron", hour=3, minute=33, id="backup")  # ночная копия базы админу
    scheduler.add_listener(_on_job_error, EVENT_JOB_ERROR)
    photos.enabled()  # предупредит в логах, если Volume для фото не подключён
    print("Admin alerts and nightly backups: " + ("on" if ADMIN_ID else
          "OFF — задайте ADMIN_ID (ваш Telegram id), чтобы получать копии базы и ошибки"))
    scheduler.start()

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())

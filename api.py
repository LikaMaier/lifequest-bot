# ============================================================
# LIFEQUEST — HTTP API мини-аппа (aiohttp) + раздача статики
# Запускается в том же процессе, что и бот (см. main() в lifequest_bot.py).
# Каждый запрос к /api/* несёт Telegram initData в заголовке
# X-Telegram-Init-Data; user_id берётся только из проверенной подписи.
# ============================================================

import asyncio
import base64
import binascii
import json
import os
import time
from datetime import datetime, timezone
from collections import defaultdict, deque

from aiohttp import web

import re

import activity
import aiquest
import albums
import billing
import spheres
import chest
import yookassa_api
import client_errors
import login_bonus
import challenges
import contests
import duels
import friends
import game
import ops
import habits
import notes
import photos
import plans
from quests_database import CATALOG
import storage
from webapp_auth import InitDataError, validate_init_data

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
INIT_DATA_HEADER = "X-Telegram-Init-Data"
TZ_HEADER = "X-Timezone"
MAX_BODY = 6 * 1024 * 1024  # фото до 5 МБ + поля формы

# Ограничения частоты: (запросов, за секунд) на пользователя.
RATE_LIMITS = {
    "random": (20, 60),
    "write": (90, 60),
    "share": (5, 600),
    "upload": (40, 600),
}
# Файлы фото и .ics открываются через <img>/ссылку без заголовков — для них
# допускается подписанная короткоживущая ссылка вместо initData.
SIGNED_PATHS = re.compile(r"^/api/(photos/[0-9a-f]{32}/(full|thumb)|calendar/export\.ics)$")


class RateLimiter:
    def __init__(self):
        self.hits = defaultdict(deque)

    def allow(self, user_id: int, bucket: str) -> bool:
        limit, window = RATE_LIMITS[bucket]
        now = time.monotonic()
        q = self.hits[(user_id, bucket)]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


BOT_TOKEN_KEY = web.AppKey("bot_token", str)
BOT_KEY = web.AppKey("bot", object)
BOT_USERNAME_KEY = web.AppKey("bot_username", object)
INIT_DATA_MAX_AGE_KEY = web.AppKey("init_data_max_age", int)
LIMITER_KEY = web.AppKey("limiter", "RateLimiter")


def _error(status: int, message: str, code: str = None):
    body = {"error": message}
    if code:
        body["code"] = code
    return web.json_response(body, status=status)


@web.middleware
async def errors_middleware(request, handler):
    try:
        return await handler(request)
    except game.QuestError as e:
        return _error(400, str(e), e.code)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _error(400, "Некорректный запрос")
    except web.HTTPException:
        raise
    except Exception as e:
        await ops.alert(f"API {request.method} {request.path}", e)
        return _error(500, "Что-то сломалось — мы уже чиним")


@web.middleware
async def auth_middleware(request, handler):
    if not request.path.startswith("/api/"):
        return await handler(request)
    if request.method == "GET" and "sig" in request.query and SIGNED_PATHS.match(request.path):
        return await handler(request)  # подпись проверяет сам обработчик
    app = request.app
    try:
        data = validate_init_data(request.headers.get(INIT_DATA_HEADER, ""), app[BOT_TOKEN_KEY],
                                  max_age=app[INIT_DATA_MAX_AGE_KEY])
    except InitDataError:
        return _error(401, "Открой приложение из Telegram, чтобы продолжить")
    user = data["user"]
    user_id = user["id"]
    storage.ensure_user(user_id, user.get("username"), user.get("first_name"))
    # Часовой пояс подставляем автоматически при первом входе.
    tz = request.headers.get(TZ_HEADER, "")
    if tz and not storage.get_user(user_id).get("tz") and game.valid_tz(tz):
        storage.update_user(user_id, tz=tz)
    if request.path == "/api/state":
        storage.mark_seen(user_id)  # открыл приложение: время визита, снова можно писать
    request["user_id"] = user_id
    return await handler(request)


@web.middleware
async def headers_middleware(request, handler):
    resp = await handler(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif request.path.startswith("/assets/v") and resp.status == 200:
        # Версия в адресе меняется с каждым деплоем — файл по этому адресу не меняется никогда.
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    else:
        # Telegram WebView агрессивно кэширует — после деплоя нужна свежая версия.
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def _limit(request, bucket: str):
    if not request.app[LIMITER_KEY].allow(request["user_id"], bucket):
        raise web.HTTPTooManyRequests(text=json.dumps({"error": "Слишком быстро! Подожди немного 🙂"}),
                                      content_type="application/json")


async def _body(request) -> dict:
    if not request.can_read_body:
        return {}
    data = await request.json()
    if not isinstance(data, dict):
        raise game.QuestError("Некорректный запрос")
    return data


def _int(value, name="id") -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise game.QuestError(f"Некорректный {name}")


# ==================== HANDLERS ====================
def _state(request) -> dict:
    data = game.get_state(request["user_id"])
    data["bot_username"] = request.app.get(BOT_USERNAME_KEY)
    data["habits"] = habits.summary(request["user_id"])
    data["chest"] = chest.status(request["user_id"], data["habits"])
    data["duels"] = duels.list_view(request["user_id"])
    data["login"] = login_bonus.status(request["user_id"])
    data["gift_theme"] = game.gift_today(storage.get_user(request["user_id"]))
    _mark_duel_habits(request["user_id"], data["habits"]["items"])
    data["plans_today"] = plans.today_plans(request["user_id"])
    data["plans_overdue"] = len(plans.overdue_plans(request["user_id"]))
    data["photos"] = photos.stats(request["user_id"])
    user = storage.get_user(request["user_id"])
    data["user"]["morning_plans"] = bool(user.get("morning_plans", 1))
    data["premium"] = billing.premium_view(user)
    data["premium"]["sbp"] = yookassa_api.enabled() and not game.premium_forever(user)
    if data["premium"]["sbp"]:  # цены для СБП — в рублях, даже если платёжная форма Telegram не подключена
        data["premium"]["sbp_prices"] = {p: billing.format_amount(billing.price(user["user_id"], p, "RUB"), "RUB")
                                         for p in yookassa_api.PRODUCTS}
    data["premium"]["payments"] = data["premium"]["payments"] or data["premium"]["sbp"]
    data["user_spheres"] = spheres.list_spheres(request["user_id"])
    data["challenge"] = challenges.summary(request["user_id"])
    data["contests"] = contests.summary(request["user_id"])
    return data


async def client_error(request):
    """Страница сообщает, что не смогла загрузиться (без авторизации — см. client_errors)."""
    try:
        raw = await request.content.read(8192)
        data = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return web.json_response({"ok": False}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"ok": False}, status=400)
    ip = request.headers.get("X-Forwarded-For", request.remote or "").split(",")[0].strip()
    text = client_errors.build_report(data, ip, request.headers.get("User-Agent", ""), request.app[BOT_TOKEN_KEY])
    if text:
        asyncio.get_running_loop().create_task(ops.notify_admin(text))
    return web.json_response({"ok": True})


async def get_state(request):
    # оплата на странице ЮKassa могла пройти, пока человека не было — подтянем её
    if yookassa_api.enabled() and yookassa_api.pending_ids(request["user_id"]):
        for res in await yookassa_api.sync_pending(request["user_id"]):
            await _notify_paid(res)
    return web.json_response(_state(request))


async def quest_random(request):
    _limit(request, "random")
    data = await _body(request)
    quest = game.random_quest(request["user_id"], str(data.get("mode", "")), data.get("sphere") or None)
    return web.json_response({"quest": quest, "new_achievements": game.check_achievements(request["user_id"])})


async def quest_accept(request):
    _limit(request, "write")
    data = await _body(request)
    result = game.accept_quest(request["user_id"], str(data.get("id", "")), data.get("tier"), bool(data.get("daily")))
    return web.json_response(result)


async def quest_complete(request):
    _limit(request, "write")
    data = await _body(request)
    result = game.complete_quest(request["user_id"], _int(data.get("active_id")))
    if result is None:
        return _error(404, "Это задание уже закрыто")
    user = storage.get_user(request["user_id"])
    # после 3-го выполненного квеста — один раз предлагаем пробную неделю Premium
    result["challenge"] = challenges.check(request["user_id"])
    result["trial_offer"] = (billing.trial_available(user)
                             and billing.done_count(request["user_id"]) == billing.TRIAL_AFTER_QUESTS)
    return web.json_response(result)


async def quest_skip(request):
    _limit(request, "write")
    data = await _body(request)
    if not game.skip_quest(request["user_id"], _int(data.get("active_id"))):
        return _error(404, "Это задание уже закрыто")
    return web.json_response({"ok": True})


async def favorite(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(game.set_favorite(request["user_id"], str(data.get("id", "")), bool(data.get("on", True))))


async def get_stats(request):
    rng = request.query.get("range", "7")
    if rng not in ("1", "7", "14", "30", "all"):
        rng = "7"
    data = game.get_stats(request["user_id"], rng)
    # Ползунки сфер: квесты + выполненные привычки, по сферам пользователя (и своим тоже).
    series = data["series"]
    by_quest = {x["sphere"]: x["count"] for x in data["spheres"]}
    by_habit = {}
    if series:
        from datetime import date as _date
        by_habit = habits.done_by_sphere(request["user_id"], _date.fromisoformat(series[0]["date"]),
                                         _date.fromisoformat(series[-1]["date"]))
    data["spheres"] = [{**s, "sphere": s["key"], "quests": by_quest.get(s["key"], 0), "habits": by_habit.get(s["key"], 0),
                        "count": by_quest.get(s["key"], 0) + by_habit.get(s["key"], 0)}
                       for s in spheres.list_spheres(request["user_id"])]
    if series:  # итоги периода: привычки, дела, квесты и XP по дням + сравнение с прошлым периодом
        from datetime import date as _date
        data["activity"] = activity.summary(request["user_id"], _date.fromisoformat(series[0]["date"]),
                                            _date.fromisoformat(series[-1]["date"]), compare=rng != "all")
    return web.json_response(data)


async def get_achievements(request):
    user = storage.get_user(request["user_id"])
    return web.json_response({
        "achievements": game.achievements_view(request["user_id"]),
        "level": game.level_info(user.get("xp") or 0),
        "levels": [{"level": i + 1, "name": name, "xp": xp} for i, (xp, name) in enumerate(game.LEVELS)],
        "unlocks": game.unlocks(game.level_for_xp(user.get("xp") or 0), game.is_premium(user), game.owned_with_gifts(user),
                                game.mascots_open(user)),
    })


async def get_board(request):
    return web.json_response(game.get_board(request["user_id"]))


async def post_board(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(game.save_board(request["user_id"], data.get("board", data)))


async def post_settings(request):
    _limit(request, "write")
    data = await _body(request)
    game.update_settings(request["user_id"], data)
    return web.json_response(_state(request))


async def premium_interest(request):
    """«Хочу Premium»: запоминаем интерес, чтобы понимать спрос до запуска оплаты."""
    _limit(request, "write")
    conn = storage.connect()
    conn.execute(
        "UPDATE users SET premium_interest_at = COALESCE(premium_interest_at, ?) WHERE user_id = ?",
        (datetime.now(timezone.utc).isoformat(timespec="seconds"), request["user_id"]),
    )
    conn.commit()
    conn.close()
    return web.json_response({"ok": True})


async def premium_invoice(request):
    """Ссылка на счёт (рубли через ЮKassa или звёзды) — мини-апп открывает её через openInvoice."""
    _limit(request, "write")
    bot = request.app.get(BOT_KEY)
    if bot is None:
        return _error(503, "Оплата сейчас недоступна — попробуй чуть позже")
    data = await _body(request)
    p = billing.invoice_params(request["user_id"], str(data.get("product") or ""),
                               str(data.get("currency") or "") or None)
    from aiogram.types import LabeledPrice
    link = await bot.create_invoice_link(title=p["title"], description=p["description"], payload=p["payload"],
                                         provider_token=p["provider_token"], currency=p["currency"],
                                         prices=[LabeledPrice(label=p["title"], amount=p["amount"])], **p["extra"])
    return web.json_response({"link": link, "stars": p["stars"], "currency": p["currency"]})


def _return_url(request) -> str:
    """Куда ЮKassa вернёт после оплаты — в чат с ботом (или в приложение)."""
    username = request.app.get(BOT_USERNAME_KEY)
    return f"https://t.me/{username}" if username else (MINIAPP_URL or "https://t.me")


PAID_SBP_TEXT = {
    "premium_month": "👑 <b>Premium активен</b> до {until}. Спасибо, что поддерживаешь LifeQuest! 💛",
    "premium_year": "👑 <b>Premium на год</b> — до {until}. Спасибо, что ты с нами 💛",
}


async def _notify_paid(res: dict):
    if res and not res.get("duplicate") and res.get("product") in PAID_SBP_TEXT:
        try:  # Premium уже начислен — сообщение лишь бонус
            await ops.safe_send(res["user_id"], PAID_SBP_TEXT[res["product"]].format(until=(res.get("until") or "")[:10]),
                                parse_mode="HTML")
        except Exception as e:
            print(f"Paid notice failed: {e}")


async def premium_sbp(request):
    """Оплата через страницу ЮKassa (там есть СБП) → {"id", "url"}; мини-апп открывает url."""
    _limit(request, "write")
    data = await _body(request)
    res = await yookassa_api.create(request["user_id"], str(data.get("product") or ""), _return_url(request))
    return web.json_response({"id": res["id"], "url": res["url"]})


async def premium_sbp_check(request):
    """Мини-апп вернулся со страницы оплаты: проверяем платёж сами, не дожидаясь уведомления."""
    _limit(request, "write")
    data = await _body(request)
    res = await yookassa_api.sync(str(data.get("id") or ""), request["user_id"])
    await _notify_paid(res)
    return web.json_response({"paid": bool(res), "state": _state(request) if res else None})


async def yookassa_webhook(request):
    """HTTP-уведомление ЮKassa. Телу не верим — статус платежа проверяем запросом к API."""
    try:
        body = json.loads((await request.content.read(65536)).decode("utf-8") or "{}")
        pid = str(((body or {}).get("object") or {}).get("id") or "")
    except (ValueError, UnicodeDecodeError, AttributeError):
        return web.json_response({"ok": False}, status=400)
    if pid:
        try:
            await _notify_paid(await yookassa_api.sync(pid))
        except Exception as e:  # ЮKassa повторит уведомление, а админ узнает об ошибке
            await ops.alert("yookassa webhook", e, f"payment {pid}")
            return web.json_response({"ok": False}, status=500)
    return web.json_response({"ok": True})


async def premium_trial(request):
    _limit(request, "write")
    billing.start_trial(request["user_id"])
    return web.json_response(_state(request))


async def get_challenges(request):
    return web.json_response(challenges.view(request["user_id"]))


async def challenge_start(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(challenges.start(request["user_id"], str(data.get("id") or "")))


async def challenge_quit(request):
    _limit(request, "write")
    return web.json_response(challenges.quit_active(request["user_id"]))


async def get_packs(request):
    return web.json_response({"packs": game.packs_view(request["user_id"])})


async def get_friends(request):
    return web.json_response(friends.list_view(request["user_id"]))


_NOTIFY_TASKS = set()


async def _send_quiet(user_id: int, text: str, kwargs: dict):
    try:
        await ops.safe_send(user_id, text, **kwargs)
    except Exception as e:  # уведомление — не повод ронять запрос
        print(f"notify {user_id} failed: {e}")


MINIAPP_URL = ""  # задаёт бот при старте (lifequest_bot.main)


def _notify(messages):
    """Отправить в Telegram сообщения вида (user_id, text[, …]). Под сообщением —
    только кнопка «Открыть LifeQuest»: отвечать на вызовы и т. п. — в приложении."""
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
    for m in messages or []:
        kwargs = {"parse_mode": "HTML"}
        if MINIAPP_URL:
            kwargs["reply_markup"] = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
                text="✨ Открыть LifeQuest", web_app=WebAppInfo(url=f"{MINIAPP_URL}{'&' if '?' in MINIAPP_URL else '?'}v={asset_version()}#friends"))]])
        task = asyncio.get_running_loop().create_task(_send_quiet(m[0], m[1], kwargs))
        _NOTIFY_TASKS.add(task)
        task.add_done_callback(_NOTIFY_TASKS.discard)


def _with_notify(result: dict) -> dict:
    _notify(result.pop("messages", None))
    return result


async def get_duels(request):
    return web.json_response(duels.list_view(request["user_id"]))


async def duel_create(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(_with_notify(duels.create(request["user_id"], data)))


async def duel_action(request):
    _limit(request, "write")
    action = request.match_info["action"]
    fn = {"accept": duels.accept, "decline": duels.decline, "nudge": duels.nudge, "giveup": duels.give_up,
          "remove": duels.remove}.get(action)
    if not fn:
        raise web.HTTPNotFound()
    result = _with_notify(fn(request["user_id"], _int(request.match_info["id"])))
    result["duels"] = duels.list_view(request["user_id"])
    return web.json_response(result)


# ---------- свои соревнования (contests.py) ----------
def _contest_id(request) -> int:
    cid = _int(request.match_info["id"])
    if not contests.was_member(cid, request["user_id"]):
        raise game.QuestError("Соревнование не найдено")
    return cid


async def get_contests(request):
    return web.json_response(contests.list_view(request["user_id"]))


async def contest_create(request):
    _limit(request, "write")
    return web.json_response(contests.create(request["user_id"], await _body(request)))


async def get_contest(request):
    return web.json_response({"contest": contests.view(_contest_id(request), request["user_id"])})


async def contest_item_add(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(contests.add_item(request["user_id"], _contest_id(request), data))


async def contest_item_update(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(contests.update_item(request["user_id"], _contest_id(request),
                                                  _int(request.match_info["item"]), data))


async def contest_item_delete(request):
    _limit(request, "write")
    return web.json_response(contests.delete_item(request["user_id"], _contest_id(request),
                                                  _int(request.match_info["item"])))


async def contest_template(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(contests.apply_template(request["user_id"], _contest_id(request),
                                                     str(data.get("template") or "")))


async def contest_launch(request):
    _limit(request, "write")
    return web.json_response(_with_notify(contests.launch(request["user_id"], _contest_id(request))))


async def contest_log(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(contests.log(request["user_id"], _contest_id(request),
                                          _int(data.get("item_id")), data.get("value")))


async def contest_leave(request):
    _limit(request, "write")
    result = _with_notify(contests.leave(request["user_id"], _contest_id(request)))
    result["contests"] = contests.list_view(request["user_id"])
    return web.json_response(result)


# ---------- общие альбомы и доступ к моему альбому (albums.py) ----------
async def get_albums(request):
    return web.json_response(albums.list_view(request["user_id"]))


async def album_create(request):
    _limit(request, "write")
    return web.json_response(albums.create(request["user_id"], await _body(request)))


async def get_album(request):
    return web.json_response({"album": albums.view(request["user_id"], _int(request.match_info["id"]))})


async def album_invite(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(_with_notify(albums.invite(request["user_id"], _int(request.match_info["id"]),
                                                        _int(data.get("friend_id"), "друг"))))


async def album_leave(request):
    _limit(request, "write")
    return web.json_response(_with_notify(albums.leave(request["user_id"], _int(request.match_info["id"]))))


async def album_update(request):
    _limit(request, "write")
    return web.json_response(albums.update(request["user_id"], _int(request.match_info["id"]), await _body(request)))


async def album_delete(request):
    _limit(request, "write")
    return web.json_response(_with_notify(albums.delete_album(request["user_id"], _int(request.match_info["id"]))))


async def album_photo_delete(request):
    _limit(request, "write")
    return web.json_response(albums.delete_photo(request["user_id"], _int(request.match_info["id"]),
                                                 request.match_info["pid"]))


async def get_album_access(request):
    return web.json_response({"access": albums.access_view(request["user_id"])})


async def album_access(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(_with_notify(albums.set_access(request["user_id"], _int(data.get("friend_id"), "друг"),
                                                            bool(data.get("on")))))


async def get_friend_album(request):
    return web.json_response(albums.friend_album(request["user_id"], _int(request.match_info["uid"])))


async def friend_remove(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(friends.remove(request["user_id"], _int(data.get("id"))))


async def ai_options(request):
    user = storage.get_user(request["user_id"])
    data = aiquest.options()
    data["limit"] = aiquest.limit_for(user)
    return web.json_response(data)


async def ai_quest(request):
    _limit(request, "random")
    data = await _body(request)
    return web.json_response(await aiquest.generate(request["user_id"], str(data.get("mood") or ""),
                                                    str(data.get("time") or ""), str(data.get("place") or "")))


async def get_recap(request):
    period = request.query.get("period", "month")
    if period == "year" and not game.is_premium(storage.get_user(request["user_id"])):
        raise game.QuestError("Итоги года — в Premium 💛", code="premium_recap")
    return web.json_response(game.recap(request["user_id"], period))


async def get_spheres(request):
    return web.json_response({"spheres": spheres.list_spheres(request["user_id"])})


async def sphere_create(request):
    _limit(request, "write")
    return web.json_response({"spheres": spheres.create(request["user_id"], await _body(request))})


async def sphere_update(request):
    _limit(request, "write")
    data = await _body(request)
    key = request.match_info["key"]
    if data.get("reset"):
        return web.json_response({"spheres": spheres.reset(request["user_id"], key)})
    return web.json_response({"spheres": spheres.update(request["user_id"], key, data)})


async def sphere_delete(request):
    _limit(request, "write")
    return web.json_response({"spheres": spheres.delete(request["user_id"], request.match_info["key"])})


async def get_shop(request):
    return web.json_response(game.shop_view(request["user_id"]))


async def shop_buy(request):
    _limit(request, "write")
    data = await _body(request)
    shop = game.buy(request["user_id"], str(data.get("item") or ""))
    return web.json_response({"shop": shop, "state": _state(request)})


async def shop_equip(request):
    _limit(request, "write")
    data = await _body(request)
    item = data.get("item")
    shop = game.equip(request["user_id"], str(item) if item else None)
    return web.json_response({"shop": shop, "state": _state(request)})


async def post_share(request):
    """Картинка-карточка из canvas → бот присылает её в чат, откуда её
    удобно переслать друзьям или выложить в сторис."""
    _limit(request, "share")
    bot = request.app.get(BOT_KEY)
    if bot is None:
        return _error(503, "Поделиться сейчас нельзя")
    data = await _body(request)
    image = str(data.get("image", ""))
    prefixes = {"data:image/png;base64,": b"\x89PNG", "data:image/jpeg;base64,": b"\xff\xd8\xff"}
    prefix = next((p for p in prefixes if image.startswith(p)), None)
    if not prefix:
        raise game.QuestError("Нужна картинка PNG или JPEG")
    try:
        raw = base64.b64decode(image[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        raise game.QuestError("Картинка повреждена")
    if len(raw) > 4_000_000 or not raw.startswith(prefixes[prefix]):
        raise game.QuestError("Картинка слишком большая")
    from aiogram.types import BufferedInputFile
    await bot.send_photo(request["user_id"], BufferedInputFile(raw, filename="lifequest.png" if prefix.endswith("png;base64,") else "lifequest.jpg"),
                         caption="✨ Мой прогресс в LifeQuest. Перешли друзьям — пусть тоже начнут свой путь к победе!")
    return web.json_response({"ok": True})


def _mark_duel_habits(user_id: int, items: list) -> list:
    """Значок «⚔️ с Верой» у привычек, по которым идёт вызов."""
    badges = duels.habit_badges(user_id)
    for item in items:
        item["duel"] = badges.get(str(item["id"]))
    return items


async def get_habits(request):
    return web.json_response({"habits": _mark_duel_habits(request["user_id"], habits.habits_view(request["user_id"])),
                              "limit": habits.HABITS_LIMIT,
                              "colors": list(habits.COLORS), "pause": habits.current_pause(request["user_id"])})


async def habit_create_many(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(habits.create_many(request["user_id"], data.get("items")))


async def habit_stats(request):
    return web.json_response(habits.stats(request["user_id"], _int(request.match_info["id"])))


async def habit_skip(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(habits.skip_habit(request["user_id"], _int(data.get("id")), data.get("date"), data.get("note")))


async def habit_pause(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(habits.set_pause(request["user_id"], data.get("days")))


async def habit_unpause(request):
    _limit(request, "write")
    return web.json_response(habits.end_pause(request["user_id"]))


async def habit_create(request):
    _limit(request, "write")
    return web.json_response(habits.create_habit(request["user_id"], await _body(request)))


async def habit_update(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(habits.update_habit(request["user_id"], _int(data.get("id")), data))


async def habit_delete(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(habits.delete_habit(request["user_id"], _int(data.get("id"))))


async def get_notes(request):
    q = request.query
    try:
        limit, offset = int(q.get("limit", 50)), int(q.get("offset", 0))
    except ValueError:
        return _error(400, "Некорректный запрос")
    return web.json_response(notes.list_notes(request["user_id"], q.get("day"), q.get("q"), limit, offset,
                                              q.get("from"), q.get("to")))


async def create_note(request):
    _limit(request, "write")
    return web.json_response({"note": notes.create_note(request["user_id"], await _body(request))})


async def patch_note(request):
    _limit(request, "write")
    return web.json_response({"note": notes.update_note(request["user_id"], _int(request.match_info["id"]),
                                                        await _body(request))})


async def delete_note(request):
    _limit(request, "write")
    return web.json_response(notes.delete_note(request["user_id"], _int(request.match_info["id"])))


async def habit_log(request):
    _limit(request, "write")
    data = await _body(request)
    uid = request["user_id"]
    days_before = billing.habit_days(uid)
    result = habits.log_habit(uid, _int(data.get("id")), delta=data.get("delta"), count=data.get("count"), day=data.get("date"))
    # третий день с привычками — один раз предлагаем пробную неделю Premium
    days_after = billing.habit_days(uid)
    result["trial_offer"] = (days_before < billing.TRIAL_AFTER_HABIT_DAYS <= days_after
                             and billing.trial_available(storage.get_user(uid)))
    if result.get("just_done"):
        _notify(duels.on_habit_done(uid, _int(data.get("id"))))
    return web.json_response(result)


async def login_claim(request):
    _limit(request, "write")
    return web.json_response(login_bonus.claim(request["user_id"]))


async def chest_open(request):
    _limit(request, "write")
    data = await _body(request)
    pick = data.get("pick") if isinstance(data.get("pick"), str) else None
    return web.json_response(chest.open_chest(request["user_id"], pick=pick))


async def plan_subtask(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.toggle_subtask(request["user_id"], _int(request.match_info["id"]), data.get("index"), data.get("done")))


async def plan_focus(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.set_focus(request["user_id"], data.get("id"), data.get("date")))


async def get_inbox(request):
    return web.json_response({"inbox": plans.inbox_list(request["user_id"])})


async def add_inbox(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.inbox_add(request["user_id"], data.get("title")))


async def delete_inbox(request):
    _limit(request, "write")
    return web.json_response(plans.inbox_delete(request["user_id"], _int(request.match_info["id"])))


async def schedule_inbox(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.inbox_schedule(request["user_id"], _int(request.match_info["id"]), data))


# ==================== ПЛАНЫ И КАЛЕНДАРЬ ====================
def _range(request) -> tuple:
    start = plans.parse_date(request.query.get("from"), "дата начала")
    end = plans.parse_date(request.query.get("to"), "дата конца")
    if end < start:
        raise game.QuestError("Конец периода раньше начала")
    return start, end


async def get_plans(request):
    start, end = _range(request)
    items = plans.occurrences(request["user_id"], start, end)
    for o in items:  # эмодзи дела для цветных карточек дня
        o["emoji"] = plans.plan_emoji(o)
    return web.json_response({"plans": items})


async def create_plan(request):
    _limit(request, "write")
    return web.json_response({"plan": plans.create_plan(request["user_id"], await _body(request))})


async def patch_plan(request):
    _limit(request, "write")
    return web.json_response({"plan": plans.update_plan(request["user_id"], _int(request.match_info["id"]), await _body(request))})


async def delete_plan(request):
    _limit(request, "write")
    scope = request.query.get("scope", "all")
    return web.json_response(plans.delete_plan(request["user_id"], _int(request.match_info["id"]),
                                               request.query.get("date"), whole=scope != "day"))


async def complete_plan(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.complete_plan(request["user_id"], _int(request.match_info["id"]), data.get("date")))


async def uncomplete_plan(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.uncomplete_plan(request["user_id"], _int(request.match_info["id"]), data.get("date")))


async def skip_plan(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.skip_plan(request["user_id"], _int(request.match_info["id"]), data.get("date")))


async def move_plan(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.move_plan(request["user_id"], _int(request.match_info["id"]), data.get("date"), data.get("to")))


async def day_mood(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.set_mood(request["user_id"], str(data.get("day") or ""), data.get("mood")))


async def day_moods(request):
    return web.json_response({"moods": plans.moods(request["user_id"], request.query.get("from", ""),
                                                    request.query.get("to", ""))})


async def calendar_summary(request):
    return web.json_response(plans.month_summary(request["user_id"], request.query.get("month", "")))


def _ics_response(user_id: int, start, end):
    if (end - start).days > plans.RANGE_MAX_DAYS:
        raise game.QuestError("Слишком большой период")
    body = plans.export_ics(user_id, start, end)
    return web.Response(text=body, content_type="text/calendar", charset="utf-8",
                        headers={"Content-Disposition": 'attachment; filename="lifequest.ics"'})


async def export_ics(request):
    q = request.query
    if "sig" in q:
        try:
            uid, exp = int(q.get("u", "0")), int(q.get("exp", "0"))
        except ValueError:
            return _error(403, "Ссылка недействительна")
        if not photos.verify(uid, f"ics:{q.get('from')}:{q.get('to')}", "ics", exp, q.get("sig")):
            return _error(403, "Ссылка устарела — открой экспорт заново")
        start, end = plans.parse_date(q.get("from")), plans.parse_date(q.get("to"))
        return _ics_response(uid, start, end)
    start, end = _range(request)
    return _ics_response(request["user_id"], start, end)


async def export_link(request):
    data = await _body(request)
    start, end = plans.parse_date(data.get("from")), plans.parse_date(data.get("to"))
    if end < start or (end - start).days > plans.RANGE_MAX_DAYS:
        raise game.QuestError("Некорректный период")
    uid = request["user_id"]
    signed = photos.sign(uid, f"ics:{start.isoformat()}:{end.isoformat()}", "ics")
    _path, query = signed.split("?", 1)
    return web.json_response({"url": f"api/calendar/export.ics?{query}&from={start.isoformat()}&to={end.isoformat()}"})


async def search_quests(request):
    """Поиск по банку заданий для «Запланировать задание»."""
    query = request.query.get("q", "").strip().lower()[:60]
    mode = request.query.get("mode")
    sphere = request.query.get("sphere")
    items = []
    for q in CATALOG.values():
        if q.get("pack"):
            continue
        if mode in game.MODES and q["mode"] != mode:
            continue
        if sphere and q["sphere"] != sphere:
            continue
        if query and query not in q["title"].lower() and query not in q["text"].lower():
            continue
        items.append(game.public_quest(q))
        if len(items) >= 60:
            break
    return web.json_response({"quests": items})


# ==================== ФОТО ====================
async def upload_photo(request):
    _limit(request, "upload")
    if not photos.enabled():
        return _error(503, "Фото пока недоступны")
    reader = await request.multipart()
    fields, raw = {}, b""
    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "file":
            raw = await part.read(decode=False)
            if len(raw) > photos.MAX_BYTES:
                raise game.QuestError("Фото больше 5 МБ — выбери поменьше")
        elif part.name in ("target", "quest_history_id", "plan_id", "plan_date", "day", "board_cell", "caption",
                           "album_id"):
            fields[part.name] = (await part.text())[:200]
    return web.json_response(photos.save_upload(request["user_id"], raw, fields))


async def list_photos(request):
    return web.json_response({"photos": photos.list_photos(request["user_id"], dict(request.query)), **photos.stats(request["user_id"])})


async def get_photo_file(request):
    photo_id, kind = request.match_info["id"], request.match_info["kind"]
    q = request.query
    if "sig" in q:
        try:
            uid, exp = int(q.get("u", "0")), int(q.get("exp", "0"))
        except ValueError:
            return _error(403, "Ссылка недействительна")
        if not photos.verify(uid, photo_id, kind, exp, q.get("sig")):
            return _error(403, "Ссылка устарела")
    else:
        uid = request["user_id"]
    path = photos.file_path(uid, photo_id, kind)
    if not path:
        return _error(404, "Фото не найдено")
    resp = web.FileResponse(path, headers={"Content-Type": "image/jpeg"})
    return resp


async def patch_photo(request):
    _limit(request, "write")
    data = await _body(request)
    pid = request.match_info["id"]
    album_id = albums.photo_album(pid)
    if album_id and albums.is_member(album_id, request["user_id"]):  # общий альбом — подпись меняет любой участник
        return web.json_response(albums.set_caption(request["user_id"], album_id, pid, data.get("caption")))
    return web.json_response(photos.set_caption(request["user_id"], pid, data.get("caption")))


async def delete_photo(request):
    _limit(request, "write")
    return web.json_response(photos.delete_photo(request["user_id"], request.match_info["id"]))


async def delete_my_photos(request):
    _limit(request, "write")
    return web.json_response({"deleted": photos.delete_all(request["user_id"])})


async def delete_my_data(request):
    _limit(request, "write")
    data = await _body(request)
    if data.get("confirm") != "DELETE":
        raise game.QuestError("Нужно подтверждение")
    uid = request["user_id"]
    photos.delete_all(uid)
    storage.delete_user_data(uid)
    return web.json_response({"ok": True})


# ---------- версия статики ----------
# iPhone (WKWebView в Telegram) берёт JS-модули из своего кэша, не спрашивая
# сервер: после деплоя новый app.js встречал старые dom.js/ui.js — импорты не
# сходились, и приложение не открывалось. Поэтому файлы отдаются по адресу с
# версией (/assets/v<хэш>/…): новый деплой — новый адрес, старому кэшу не
# с чем смешаться. Хэш считается по содержимому файлов, один раз при старте.
_ASSET_VERSION = None


def asset_version() -> str:
    global _ASSET_VERSION
    if _ASSET_VERSION is None:
        import hashlib
        h = hashlib.sha1()
        root = os.path.join(STATIC_DIR, "assets")
        for folder, _dirs, files in sorted(os.walk(root)):
            for name in sorted(files):
                path = os.path.join(folder, name)
                h.update(os.path.relpath(path, root).encode())
                with open(path, "rb") as f:
                    h.update(f.read())
        _ASSET_VERSION = h.hexdigest()[:10]
    return _ASSET_VERSION


def _index_html() -> str:
    with open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read()
    v = asset_version()
    return html.replace('href="assets/', f'href="assets/v{v}/').replace('src="assets/', f'src="assets/v{v}/')


async def privacy(request):
    """Политика конфиденциальности — публичная страница (ссылка для @BotFather, ЮKassa и профиля)."""
    with open(os.path.join(STATIC_DIR, "privacy.html"), encoding="utf-8") as f:
        page = f.read()
    username = request.app.get(BOT_USERNAME_KEY)
    name = f"@{username}" if username else "LifeQuest в Telegram"
    link = f'<a href="https://t.me/{username}">@{username}</a>' if username else name
    return web.Response(text=page.replace("{{BOT_LINK}}", link).replace("{{BOT_NAME}}", name),
                        content_type="text/html", charset="utf-8")


async def index(request):
    return web.Response(text=_index_html(), content_type="text/html", charset="utf-8")


async def versioned_asset(request):
    """/assets/v<версия>/<путь> — тот же файл из static/assets (версия — только для кэша)."""
    root = os.path.realpath(os.path.join(STATIC_DIR, "assets"))
    path = os.path.realpath(os.path.join(root, request.match_info["tail"]))
    if not path.startswith(root + os.sep) or not os.path.isfile(path):
        raise web.HTTPNotFound()
    return web.FileResponse(path)


async def health(request):
    return web.json_response({"ok": True})


def create_app(bot_token: str, bot=None, init_data_max_age: int = None) -> web.Application:
    app = web.Application(client_max_size=MAX_BODY,
                          middlewares=[headers_middleware, errors_middleware, auth_middleware])
    app[BOT_TOKEN_KEY] = bot_token
    app[BOT_KEY] = bot
    app[BOT_USERNAME_KEY] = None
    app[INIT_DATA_MAX_AGE_KEY] = init_data_max_age or int(os.getenv("INIT_DATA_MAX_AGE", 24 * 3600))
    app[LIMITER_KEY] = RateLimiter()
    photos.configure(bot_token)
    app.router.add_post("/client-error", client_error)  # вне /api/: работает и без initData
    app.router.add_get("/api/state", get_state)
    app.router.add_post("/api/quest/random", quest_random)
    app.router.add_post("/api/quest/accept", quest_accept)
    app.router.add_post("/api/quest/complete", quest_complete)
    app.router.add_post("/api/quest/skip", quest_skip)
    app.router.add_post("/api/favorite", favorite)
    app.router.add_get("/api/stats", get_stats)
    app.router.add_get("/api/achievements", get_achievements)
    app.router.add_get("/api/board", get_board)
    app.router.add_post("/api/board", post_board)
    app.router.add_post("/api/settings", post_settings)
    app.router.add_post("/api/share", post_share)
    app.router.add_post("/api/premium/interest", premium_interest)
    app.router.add_post("/api/premium/invoice", premium_invoice)
    app.router.add_post("/api/premium/sbp", premium_sbp)
    app.router.add_post("/api/premium/sbp/check", premium_sbp_check)
    app.router.add_post("/yookassa/webhook", yookassa_webhook)  # вне /api/: без initData
    app.router.add_post("/api/premium/trial", premium_trial)
    app.router.add_get("/api/challenges", get_challenges)
    app.router.add_post("/api/challenges/start", challenge_start)
    app.router.add_post("/api/challenges/quit", challenge_quit)
    app.router.add_get("/api/packs", get_packs)
    app.router.add_post("/api/chest/open", chest_open)
    app.router.add_post("/api/login/claim", login_claim)
    app.router.add_get("/api/duels", get_duels)
    app.router.add_post("/api/duels", duel_create)
    app.router.add_post("/api/duels/{id}/{action}", duel_action)
    app.router.add_get("/api/contests", get_contests)
    app.router.add_post("/api/contests", contest_create)
    app.router.add_get("/api/contests/{id:[0-9]+}", get_contest)
    app.router.add_post("/api/contests/{id:[0-9]+}/items", contest_item_add)
    app.router.add_patch("/api/contests/{id:[0-9]+}/items/{item:[0-9]+}", contest_item_update)
    app.router.add_delete("/api/contests/{id:[0-9]+}/items/{item:[0-9]+}", contest_item_delete)
    app.router.add_post("/api/contests/{id:[0-9]+}/template", contest_template)
    app.router.add_post("/api/contests/{id:[0-9]+}/launch", contest_launch)
    app.router.add_post("/api/contests/{id:[0-9]+}/log", contest_log)
    app.router.add_post("/api/contests/{id:[0-9]+}/leave", contest_leave)
    app.router.add_get("/api/albums", get_albums)
    app.router.add_post("/api/albums", album_create)
    app.router.add_get("/api/albums/access", get_album_access)
    app.router.add_post("/api/albums/access", album_access)
    app.router.add_get("/api/albums/friend/{uid:[0-9]+}", get_friend_album)
    app.router.add_get("/api/albums/{id:[0-9]+}", get_album)
    app.router.add_post("/api/albums/{id:[0-9]+}/invite", album_invite)
    app.router.add_post("/api/albums/{id:[0-9]+}/leave", album_leave)
    app.router.add_patch("/api/albums/{id:[0-9]+}", album_update)
    app.router.add_delete("/api/albums/{id:[0-9]+}", album_delete)
    app.router.add_delete("/api/albums/{id:[0-9]+}/photos/{pid:[0-9a-f]{32}}", album_photo_delete)
    app.router.add_get("/api/friends", get_friends)
    app.router.add_post("/api/friends/remove", friend_remove)
    app.router.add_get("/api/ai/options", ai_options)
    app.router.add_post("/api/ai/quest", ai_quest)
    app.router.add_get("/api/recap", get_recap)
    app.router.add_get("/api/spheres", get_spheres)
    app.router.add_post("/api/spheres", sphere_create)
    app.router.add_patch("/api/spheres/{key}", sphere_update)
    app.router.add_delete("/api/spheres/{key}", sphere_delete)
    app.router.add_get("/api/shop", get_shop)
    app.router.add_post("/api/shop/buy", shop_buy)
    app.router.add_post("/api/shop/equip", shop_equip)
    app.router.add_get("/api/habits", get_habits)
    app.router.add_post("/api/habits", habit_create)
    app.router.add_post("/api/habits/update", habit_update)
    app.router.add_post("/api/habits/many", habit_create_many)
    app.router.add_post("/api/plans/{id:[0-9]+}/subtask", plan_subtask)
    app.router.add_post("/api/plans/focus", plan_focus)
    app.router.add_get("/api/inbox", get_inbox)
    app.router.add_post("/api/inbox", add_inbox)
    app.router.add_delete("/api/inbox/{id:[0-9]+}", delete_inbox)
    app.router.add_post("/api/inbox/{id:[0-9]+}/schedule", schedule_inbox)
    app.router.add_post("/api/habits/skip", habit_skip)
    app.router.add_get("/api/habits/{id:[0-9]+}/stats", habit_stats)
    app.router.add_post("/api/habits/pause", habit_pause)
    app.router.add_delete("/api/habits/pause", habit_unpause)
    app.router.add_post("/api/habits/delete", habit_delete)
    app.router.add_post("/api/habits/log", habit_log)
    app.router.add_get("/api/notes", get_notes)
    app.router.add_post("/api/notes", create_note)
    app.router.add_patch("/api/notes/{id}", patch_note)
    app.router.add_delete("/api/notes/{id}", delete_note)
    app.router.add_get("/api/plans", get_plans)
    app.router.add_post("/api/plans", create_plan)
    app.router.add_patch("/api/plans/{id}", patch_plan)
    app.router.add_delete("/api/plans/{id}", delete_plan)
    app.router.add_post("/api/plans/{id}/complete", complete_plan)
    app.router.add_post("/api/plans/{id}/skip", skip_plan)
    app.router.add_post("/api/plans/{id}/uncomplete", uncomplete_plan)
    app.router.add_post("/api/plans/{id}/move", move_plan)
    app.router.add_get("/api/calendar/summary", calendar_summary)
    app.router.add_post("/api/day/mood", day_mood)
    app.router.add_get("/api/day/moods", day_moods)
    app.router.add_get("/api/calendar/export.ics", export_ics)
    app.router.add_post("/api/calendar/export-link", export_link)
    app.router.add_get("/api/quests/search", search_quests)
    app.router.add_post("/api/photos", upload_photo)
    app.router.add_get("/api/photos", list_photos)
    app.router.add_get("/api/photos/{id:[0-9a-f]{32}}/{kind:(full|thumb)}", get_photo_file)
    app.router.add_patch("/api/photos/{id:[0-9a-f]{32}}", patch_photo)
    app.router.add_delete("/api/photos/{id:[0-9a-f]{32}}", delete_photo)
    app.router.add_post("/api/me/delete-photos", delete_my_photos)
    app.router.add_post("/api/me/delete-all", delete_my_data)
    app.router.add_get("/health", health)
    app.router.add_get("/", index)
    app.router.add_get("/privacy", privacy)
    assets = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets):
        # сначала адреса с версией (иначе их перехватит обычная статика)
        app.router.add_get("/assets/v{ver:[0-9a-f]{10}}/{tail:.+}", versioned_asset)
        app.router.add_static("/assets", assets)  # старые адреса — для уже открытых окон
    return app


async def start_web(bot_token: str, bot=None) -> web.AppRunner:
    """Запускает сервер на 0.0.0.0:$PORT (Railway задаёт PORT сам)."""
    app = create_app(bot_token, bot)
    if bot is not None:
        try:
            app[BOT_USERNAME_KEY] = (await bot.get_me()).username
        except Exception as e:  # сеть недоступна — приглашение просто будет без ссылки
            print(f"get_me failed: {e}")
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    port = int(os.getenv("PORT", "8080"))
    await web.TCPSite(runner, "0.0.0.0", port).start()
    print(f"Mini app server listening on :{port}")
    return runner

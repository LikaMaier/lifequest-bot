# ============================================================
# LIFEQUEST — HTTP API мини-аппа (aiohttp) + раздача статики
# Запускается в том же процессе, что и бот (см. main() в lifequest_bot.py).
# Каждый запрос к /api/* несёт Telegram initData в заголовке
# X-Telegram-Init-Data; user_id берётся только из проверенной подписи.
# ============================================================

import base64
import binascii
import json
import os
import time
from collections import defaultdict, deque

from aiohttp import web

import re

import game
import ops
import habits
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


def _error(status: int, message: str):
    return web.json_response({"error": message}, status=status)


@web.middleware
async def errors_middleware(request, handler):
    try:
        return await handler(request)
    except game.QuestError as e:
        return _error(400, str(e))
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
    data["plans_today"] = plans.today_plans(request["user_id"])
    data["plans_overdue"] = len(plans.overdue_plans(request["user_id"]))
    data["photos"] = photos.stats(request["user_id"])
    data["user"]["morning_plans"] = bool(storage.get_user(request["user_id"]).get("morning_plans", 1))
    return data


async def get_state(request):
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
    if rng not in ("7", "14", "30", "all"):
        rng = "7"
    return web.json_response(game.get_stats(request["user_id"], rng))


async def get_achievements(request):
    user = storage.get_user(request["user_id"])
    return web.json_response({
        "achievements": game.achievements_view(request["user_id"]),
        "level": game.level_info(user.get("xp") or 0),
        "levels": [{"level": i + 1, "name": name, "xp": xp} for i, (xp, name) in enumerate(game.LEVELS)],
        "unlocks": game.unlocks(game.level_for_xp(user.get("xp") or 0)),
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
                         caption="✨ Мой прогресс в LifeQuest. Перешли друзьям — пусть тоже выберутся из привычного сценария!")
    return web.json_response({"ok": True})


async def get_habits(request):
    return web.json_response({"habits": habits.habits_view(request["user_id"]), "limit": habits.HABITS_LIMIT,
                              "colors": list(habits.COLORS)})


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


async def habit_log(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(habits.log_habit(request["user_id"], _int(data.get("id")),
                                              delta=data.get("delta"), count=data.get("count"), day=data.get("date")))


# ==================== ПЛАНЫ И КАЛЕНДАРЬ ====================
def _range(request) -> tuple:
    start = plans.parse_date(request.query.get("from"), "дата начала")
    end = plans.parse_date(request.query.get("to"), "дата конца")
    if end < start:
        raise game.QuestError("Конец периода раньше начала")
    return start, end


async def get_plans(request):
    start, end = _range(request)
    return web.json_response({"plans": plans.occurrences(request["user_id"], start, end)})


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


async def skip_plan(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.skip_plan(request["user_id"], _int(request.match_info["id"]), data.get("date")))


async def move_plan(request):
    _limit(request, "write")
    data = await _body(request)
    return web.json_response(plans.move_plan(request["user_id"], _int(request.match_info["id"]), data.get("date"), data.get("to")))


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
        elif part.name in ("target", "quest_history_id", "plan_id", "plan_date", "day", "board_cell", "caption"):
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


async def index(request):
    return web.FileResponse(os.path.join(STATIC_DIR, "index.html"))


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
    app.router.add_get("/api/shop", get_shop)
    app.router.add_post("/api/shop/buy", shop_buy)
    app.router.add_post("/api/shop/equip", shop_equip)
    app.router.add_get("/api/habits", get_habits)
    app.router.add_post("/api/habits", habit_create)
    app.router.add_post("/api/habits/update", habit_update)
    app.router.add_post("/api/habits/delete", habit_delete)
    app.router.add_post("/api/habits/log", habit_log)
    app.router.add_get("/api/plans", get_plans)
    app.router.add_post("/api/plans", create_plan)
    app.router.add_patch("/api/plans/{id}", patch_plan)
    app.router.add_delete("/api/plans/{id}", delete_plan)
    app.router.add_post("/api/plans/{id}/complete", complete_plan)
    app.router.add_post("/api/plans/{id}/skip", skip_plan)
    app.router.add_post("/api/plans/{id}/move", move_plan)
    app.router.add_get("/api/calendar/summary", calendar_summary)
    app.router.add_get("/api/calendar/export.ics", export_ics)
    app.router.add_post("/api/calendar/export-link", export_link)
    app.router.add_get("/api/quests/search", search_quests)
    app.router.add_post("/api/photos", upload_photo)
    app.router.add_get("/api/photos", list_photos)
    app.router.add_get("/api/photos/{id:[0-9a-f]{32}}/{kind:(full|thumb)}", get_photo_file)
    app.router.add_delete("/api/photos/{id:[0-9a-f]{32}}", delete_photo)
    app.router.add_post("/api/me/delete-photos", delete_my_photos)
    app.router.add_post("/api/me/delete-all", delete_my_data)
    app.router.add_get("/health", health)
    app.router.add_get("/", index)
    assets = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets):
        app.router.add_static("/assets", assets)
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

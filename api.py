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

import game
import storage
from webapp_auth import InitDataError, validate_init_data

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
INIT_DATA_HEADER = "X-Telegram-Init-Data"
TZ_HEADER = "X-Timezone"
MAX_BODY = 3 * 1024 * 1024  # хватает на картинку для «Поделиться»

# Ограничения частоты: (запросов, за секунд) на пользователя.
RATE_LIMITS = {
    "random": (20, 60),
    "write": (90, 60),
    "share": (5, 600),
}


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


@web.middleware
async def auth_middleware(request, handler):
    if not request.path.startswith("/api/"):
        return await handler(request)
    app = request.app
    try:
        data = validate_init_data(request.headers.get(INIT_DATA_HEADER, ""), app["bot_token"],
                                  max_age=app["init_data_max_age"])
    except InitDataError:
        return _error(401, "Открой приложение из Telegram, чтобы продолжить")
    user = data["user"]
    user_id = user["id"]
    storage.ensure_user(user_id, user.get("username"), user.get("first_name"))
    # Часовой пояс подставляем автоматически при первом входе.
    tz = request.headers.get(TZ_HEADER, "")
    if tz and not storage.get_user(user_id).get("tz") and game.valid_tz(tz):
        storage.update_user(user_id, tz=tz)
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
    if not request.app["limiter"].allow(request["user_id"], bucket):
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
async def get_state(request):
    return web.json_response(game.get_state(request["user_id"]))


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
    return web.json_response(game.get_state(request["user_id"]))


async def post_share(request):
    """Картинка-карточка из canvas → бот присылает её в чат, откуда её
    удобно переслать подругам или выложить в сторис."""
    _limit(request, "share")
    bot = request.app.get("bot")
    if bot is None:
        return _error(503, "Поделиться сейчас нельзя")
    data = await _body(request)
    image = str(data.get("image", ""))
    prefix = "data:image/png;base64,"
    if not image.startswith(prefix):
        raise game.QuestError("Нужна картинка PNG")
    try:
        raw = base64.b64decode(image[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        raise game.QuestError("Картинка повреждена")
    if len(raw) > 2_500_000 or not raw.startswith(b"\x89PNG"):
        raise game.QuestError("Картинка слишком большая")
    from aiogram.types import BufferedInputFile
    await bot.send_photo(request["user_id"], BufferedInputFile(raw, filename="lifequest.png"),
                         caption="✨ Мой прогресс в LifeQuest. Перешли подругам — пусть тоже выберутся из привычного сценария!")
    return web.json_response({"ok": True})


async def index(request):
    return web.FileResponse(os.path.join(STATIC_DIR, "index.html"))


async def health(request):
    return web.json_response({"ok": True})


def create_app(bot_token: str, bot=None, init_data_max_age: int = None) -> web.Application:
    app = web.Application(client_max_size=MAX_BODY,
                          middlewares=[headers_middleware, errors_middleware, auth_middleware])
    app["bot_token"] = bot_token
    app["bot"] = bot
    app["init_data_max_age"] = init_data_max_age or int(os.getenv("INIT_DATA_MAX_AGE", 24 * 3600))
    app["limiter"] = RateLimiter()
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
    app.router.add_get("/health", health)
    app.router.add_get("/", index)
    assets = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets):
        app.router.add_static("/assets", assets)
    return app


async def start_web(bot_token: str, bot=None) -> web.AppRunner:
    """Запускает сервер на 0.0.0.0:$PORT (Railway задаёт PORT сам)."""
    runner = web.AppRunner(create_app(bot_token, bot), access_log=None)
    await runner.setup()
    port = int(os.getenv("PORT", "8080"))
    await web.TCPSite(runner, "0.0.0.0", port).start()
    print(f"Mini app server listening on :{port}")
    return runner

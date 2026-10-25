"""Мини-апп не загрузился у человека → короткое сообщение админу.

Страница сама присылает POST /client-error (без initData-авторизации: при сбое
её может и не быть). Поэтому всё недоверенное: длина ограничена, текст
экранируется, частота — не больше раза в 30 минут на человека/адрес и вид
сбоя и не больше 10 сообщений в час всего.
"""

import html
import time
from collections import deque

from webapp_auth import InitDataError, validate_init_data

KINDS = {
    "no_telegram": "Telegram не передал данные — приложение решило, что открыто не в Telegram",
    "load_failed": "не загрузились данные с сервера",
    "slow": "за 15 секунд приложение так и не загрузилось",
    "js_error": "ошибка в коде при загрузке",
}
PER_KEY_COOLDOWN = 30 * 60
GLOBAL_LIMIT = (10, 3600)

_last = {}
_sent = deque()


def _who(init_data: str, bot_token: str):
    """(user_id, подпись) — по initData, даже устаревшей; иначе (None, «неизвестный»)."""
    try:
        user = validate_init_data(init_data, bot_token, max_age=10 ** 9)["user"]
    except (InitDataError, KeyError, TypeError, ValueError):
        return None, "неизвестный человек"
    name = html.escape(str(user.get("first_name") or ""))[:40]
    uname = f" @{html.escape(str(user['username']))[:40]}" if user.get("username") else ""
    return user.get("id"), f"<b>{name}</b>{uname} · <code>{int(user.get('id') or 0)}</code>"


def build_report(data: dict, ip: str, ua: str, bot_token: str, now: float = None):
    """Текст сообщения админу или None (неизвестный вид, лимит частоты)."""
    kind = str(data.get("kind") or "")
    if kind not in KINDS:
        return None
    now = time.monotonic() if now is None else now
    uid, who = _who(str(data.get("initData") or "")[:4096], bot_token)
    key = (uid or ip, kind)
    if now - _last.get(key, -PER_KEY_COOLDOWN) < PER_KEY_COOLDOWN:
        return None
    while _sent and now - _sent[0] > GLOBAL_LIMIT[1]:
        _sent.popleft()
    if len(_sent) >= GLOBAL_LIMIT[0]:
        return None
    _last[key] = now
    _sent.append(now)
    platform = html.escape(str(data.get("platform") or "?"))[:30]
    version = html.escape(str(data.get("version") or "?"))[:15]
    detail = html.escape(str(data.get("detail") or ""))[:300]
    return (f"📵 <b>Мини-апп не загрузился</b>\n{who}\n"
            f"<b>Что:</b> {KINDS[kind]}" + (f"\n<code>{detail}</code>" if detail else "") +
            f"\n<b>Где:</b> Telegram {platform}, версия {version}\n<i>{html.escape(ua)[:160]}</i>")

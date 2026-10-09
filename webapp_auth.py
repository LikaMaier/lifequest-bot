# ============================================================
# Проверка Telegram WebApp initData
# https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
#   secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
#   hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
# data_check_string — все поля, кроме hash, в виде key=value, отсортированные
# по ключу и склеенные через \n.
# ============================================================

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

DEFAULT_MAX_AGE = 24 * 60 * 60  # сутки: initData не меняется, пока открыт мини-апп


class InitDataError(Exception):
    pass


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()


def sign_init_data(fields: dict, bot_token: str) -> str:
    """Собирает подписанную строку initData — для тестов и локальной отладки."""
    from urllib.parse import urlencode
    pairs = {k: (json.dumps(v, ensure_ascii=False, separators=(",", ":")) if isinstance(v, dict) else str(v))
             for k, v in fields.items()}
    check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    pairs["hash"] = hmac.new(_secret_key(bot_token), check.encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


def validate_init_data(init_data: str, bot_token: str, max_age: int = DEFAULT_MAX_AGE, now: float = None) -> dict:
    """Возвращает проверенные поля (user — уже dict). Бросает InitDataError,
    если подпись не сходится, данных нет или они устарели."""
    if not init_data or not bot_token:
        raise InitDataError("missing init data")
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        raise InitDataError("malformed init data")
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise InitDataError("no hash")

    check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    expected = hmac.new(_secret_key(bot_token), check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("bad signature")

    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        raise InitDataError("bad auth_date")
    now = time.time() if now is None else now
    if auth_date <= 0 or now - auth_date > max_age:
        raise InitDataError("init data expired")

    try:
        user = json.loads(pairs.get("user", ""))
    except ValueError:
        raise InitDataError("no user")
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        raise InitDataError("no user")
    pairs["user"] = user
    return pairs

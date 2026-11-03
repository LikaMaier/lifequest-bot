"""Метки источников: откуда пришёл человек.

Ссылка с меткой: t.me/<bot>?start=src_tiktok (или src_blogger_anya, src_pinterest).
Метка запоминается один раз — при первом входе нового человека, через бота
(/start) или сразу через мини-приложение (startapp=src_…). Пришедшие по
ссылке друга без метки считаются источником «friend»."""

import re

import storage

PREFIX = "src_"
MAX_LEN = 32
FRIEND = "friend"
DIRECT = "direct"
_BAD = re.compile(r"[^a-z0-9_\-]")


def clean(tag: str) -> str:
    """'TikTok Ноябрь!' → 'tiktok'. Пустая строка — метка негодная."""
    tag = _BAD.sub("", (tag or "").strip().lower().replace(" ", "_"))
    return tag[:MAX_LEN].strip("_-")


def from_payload(payload: str):
    """'src_tiktok' → 'tiktok'; иначе None."""
    payload = (payload or "").strip()
    if not payload.lower().startswith(PREFIX):
        return None
    return clean(payload[len(PREFIX):]) or None


def record(user_id: int, payload: str, is_new: bool) -> bool:
    """Запоминаем метку только новичку и только если её ещё нет."""
    tag = from_payload(payload)
    if not tag or not is_new:
        return False
    user = storage.get_user(user_id)
    if not user or user.get("source"):
        return False
    storage.update_user(user_id, source=tag)
    return True


def of(user: dict) -> str:
    """Источник для отчётов: метка → «friend», если позвал друг → «direct»."""
    if user.get("source"):
        return user["source"]
    return FRIEND if user.get("referred_by") else DIRECT


LABELS = {FRIEND: "🤝 друг позвал", DIRECT: "🚪 без метки"}


def label(src: str) -> str:
    return LABELS.get(src, f"🏷 {src}")


def link(bot_username: str, tag: str) -> str:
    tag = clean(tag)
    return f"https://t.me/{bot_username}?start={PREFIX}{tag}" if bot_username and tag else ""

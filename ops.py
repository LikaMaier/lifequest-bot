"""Надёжность: безопасная отправка сообщений, уведомления админу об ошибках
и резервные копии базы.

- safe_send: если человек заблокировал бота — помечаем его и больше не пишем,
  при ограничении частоты Telegram — ждём и пробуем ещё раз.
- alert: ошибка → сообщение админу (ADMIN_ID), одинаковые — не чаще раза в 15 минут.
- backup: копия SQLite через backup API (безопасно на работающей базе), gzip,
  отправка админу документом.
"""

import asyncio
import gzip
import html
import os
import shutil
import sqlite3
import tempfile
import time
import traceback
from datetime import datetime

from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter
from aiogram.types import FSInputFile

import storage

ALERT_COOLDOWN = 15 * 60
TG_DOC_LIMIT = 49 * 1024 * 1024

_bot = None
_admin_id = 0
_last_alert = {}


def setup(bot, admin_id: int):
    global _bot, _admin_id
    _bot, _admin_id = bot, admin_id


async def safe_send(user_id: int, text: str, **kwargs):
    """Отправка напоминания. Возвращает сообщение или None, если не доставлено."""
    if storage.is_blocked(user_id):
        return None
    for attempt in range(2):
        try:
            return await _bot.send_message(user_id, text, **kwargs)
        except TelegramForbiddenError:
            storage.set_blocked(user_id)
            print(f"User {user_id} blocked the bot — reminders paused")
            return None
        except TelegramRetryAfter as e:
            if attempt:
                raise
            await asyncio.sleep(min(e.retry_after, 30))
    return None


async def alert(where: str, exc: BaseException = None, details: str = ""):
    """Сообщить админу об ошибке. Без ADMIN_ID — только лог."""
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)) if exc else ""
    print(f"[ALERT] {where}: {exc!r} {details}\n{tb}")
    if not (_bot and _admin_id):
        return
    key = f"{where}:{type(exc).__name__ if exc else ''}:{str(exc)[:80]}"
    now = time.monotonic()
    if now - _last_alert.get(key, -ALERT_COOLDOWN) < ALERT_COOLDOWN:
        return
    _last_alert[key] = now
    text = f"⚠️ <b>Ошибка в LifeQuest</b>\n<b>Где:</b> {html.escape(where)}\n"
    if exc:
        text += f"<b>Что:</b> <code>{html.escape(type(exc).__name__ + ': ' + str(exc))[:500]}</code>\n"
    if details:
        text += html.escape(details)[:500] + "\n"
    if tb:
        text += f"<pre>{html.escape(tb[-1500:])}</pre>"
    try:
        await _bot.send_message(_admin_id, text[:4000], parse_mode="HTML")
    except Exception as e:  # уведомление об ошибке не должно порождать новые
        print(f"Failed to send alert: {e}")


def make_backup(dest_dir: str = None) -> str:
    """Согласованная копия базы (sqlite backup API) → .db.gz. Возвращает путь."""
    dest_dir = dest_dir or tempfile.mkdtemp(prefix="lq-backup-")
    stamp = datetime.utcnow().strftime("%Y-%m-%d_%H%M")
    raw = os.path.join(dest_dir, f"lifequest_{stamp}.db")
    src = sqlite3.connect(storage.DB_PATH)
    dst = sqlite3.connect(raw)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    gz = raw + ".gz"
    with open(raw, "rb") as f_in, gzip.open(gz, "wb", compresslevel=9) as f_out:
        shutil.copyfileobj(f_in, f_out)
    os.remove(raw)
    return gz


def backup_caption() -> str:
    conn = storage.connect()
    users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    active = conn.execute("SELECT COUNT(*) FROM users WHERE COALESCE(blocked, 0) = 0").fetchone()[0]
    done = conn.execute("SELECT COUNT(*) FROM quest_history WHERE status = 'done'").fetchone()[0]
    conn.close()
    return (f"💾 Резервная копия базы LifeQuest\n"
            f"Пользователей: {users} (активных {active}) · выполнено квестов: {done}\n"
            f"Восстановить: распаковать .gz и положить как DB_PATH (/data/lifequest.db). Фото в копию не входят.")


async def send_backup(chat_id: int = None) -> bool:
    chat_id = chat_id or _admin_id
    if not (_bot and chat_id):
        print("Backup skipped: ADMIN_ID не задан — некому отправить копию")
        return False
    path = None
    try:
        path = await asyncio.to_thread(make_backup)
        if os.path.getsize(path) > TG_DOC_LIMIT:
            await alert("backup", details=f"Копия {os.path.getsize(path) // 1024 // 1024} МБ — больше лимита Telegram")
            return False
        await _bot.send_document(chat_id, FSInputFile(path), caption=backup_caption())
        return True
    except Exception as e:
        await alert("backup", e)
        return False
    finally:
        if path:
            shutil.rmtree(os.path.dirname(path), ignore_errors=True)

"""Оплата Premium напрямую через API ЮKassa — со страницей оплаты, где есть СБП.

В платёжной форме Telegram (sendInvoice с provider_token) ЮKassa показывает
только карты, SberPay и ЮMoney, поэтому для СБП — отдельный путь:

1. create(user_id, product) — создаём платёж в ЮKassa и запоминаем его в
   yk_payments; человек открывает confirmation_url и платит (СБП, карта…).
2. ЮKassa присылает HTTP-уведомление на /yookassa/webhook, а мини-апп при
   возвращении зовёт /api/premium/sbp/check — в обоих случаях мы НЕ верим
   присланному, а сами запрашиваем платёж в API (sync) и, если он оплачен,
   начисляем покупку через billing.apply_payment (charge_id «yk:<id>» —
   повторная доставка ничего не удвоит).

Включается переменными YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY (только в
окружении, не в коде).
"""

import os
import uuid
from datetime import datetime, timedelta

import aiohttp

import billing
import game
import storage

API = "https://api.yookassa.ru/v3/payments"
SHOP_ID = os.getenv("YOOKASSA_SHOP_ID", "").strip()
SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY", "").strip()
PRODUCTS = ("premium_month", "premium_year")
TIMEOUT = aiohttp.ClientTimeout(total=20)


def enabled() -> bool:
    return bool(SHOP_ID and SECRET_KEY)


def _ensure_table():
    conn = storage.connect()
    conn.execute("""CREATE TABLE IF NOT EXISTS yk_payments (
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, product TEXT NOT NULL, amount INTEGER NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, applied INTEGER DEFAULT 0)""")
    conn.commit()
    conn.close()


async def _request(method: str, url: str, body: dict = None, idempotence_key: str = None) -> dict:
    """Запрос к API ЮKassa (в тестах подменяется)."""
    headers = {"Idempotence-Key": idempotence_key} if idempotence_key else {}
    async with aiohttp.ClientSession(timeout=TIMEOUT, auth=aiohttp.BasicAuth(SHOP_ID, SECRET_KEY)) as s:
        async with s.request(method, url, json=body, headers=headers) as resp:
            data = await resp.json(content_type=None)
            if resp.status >= 400:
                raise game.QuestError("Не получилось создать оплату — попробуй ещё раз чуть позже",
                                      code="payment_api")
            return data


async def create(user_id: int, product: str, return_url: str) -> dict:
    """Создаёт платёж → {"id", "url", "amount"}."""
    if not enabled():
        raise game.QuestError("Оплата по СБП скоро появится 💛", code="payments_off")
    if product not in PRODUCTS:
        raise game.QuestError("Такого тарифа нет")
    billing.check_purchase(user_id, product)
    amount = billing.price(user_id, product, "RUB")
    payload = billing.make_payload(user_id, product, "RUB")
    body = {
        "amount": {"value": f"{amount / 100:.2f}", "currency": "RUB"},
        "capture": True,
        "confirmation": {"type": "redirect", "return_url": return_url},
        "description": billing.PRODUCTS[product]["title"][:128],
        "metadata": {"user_id": str(user_id), "product": product, "payload": payload},
    }
    data = await _request("POST", API, body, idempotence_key=str(uuid.uuid4()))
    pid, url = data.get("id"), (data.get("confirmation") or {}).get("confirmation_url")
    if not pid or not url:
        raise game.QuestError("Не получилось создать оплату — попробуй ещё раз чуть позже", code="payment_api")
    _ensure_table()
    conn = storage.connect()
    conn.execute("""INSERT OR REPLACE INTO yk_payments (id, user_id, product, amount, payload, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)""",
                 (pid, user_id, product, amount, payload, data.get("status") or "pending", storage.utc_now_str()))
    conn.commit()
    conn.close()
    return {"id": pid, "url": url, "amount": amount}


def _pending(payment_id: str):
    _ensure_table()
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM yk_payments WHERE id = ?", (str(payment_id)[:64],)).fetchone()
    conn.close()
    return dict(row) if row else None


async def sync(payment_id: str, user_id: int = None):
    """Проверяет платёж в API ЮKassa и, если он оплачен, начисляет покупку.
    → результат apply_payment (с "duplicate", если уже начисляли) или None."""
    row = _pending(payment_id)
    if not row or (user_id is not None and row["user_id"] != user_id):
        return None
    if row["applied"]:
        return {"product": row["product"], "duplicate": True}
    data = await _request("GET", f"{API}/{row['id']}")
    status = data.get("status") or row["status"]
    amount = data.get("amount") or {}
    conn = storage.connect()
    conn.execute("UPDATE yk_payments SET status = ? WHERE id = ?", (status, row["id"]))
    conn.commit()
    conn.close()
    if status != "succeeded" or not data.get("paid"):
        return None
    paid = round(float(amount.get("value") or 0) * 100)
    if amount.get("currency") != "RUB" or paid != row["amount"]:
        raise game.QuestError(f"Сумма платежа {row['id']} не совпала")
    res = billing.apply_payment(row["user_id"], row["payload"], f"yk:{row['id']}", paid, "RUB")
    conn = storage.connect()
    conn.execute("UPDATE yk_payments SET applied = 1 WHERE id = ?", (row["id"],))
    conn.commit()
    conn.close()
    res["user_id"] = row["user_id"]
    return res


def pending_ids(user_id: int = None, hours: int = 48) -> list:
    """Неначисленные платежи за последние `hours` часов (кроме отменённых)."""
    _ensure_table()
    since = (datetime.utcnow() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")
    sql = "SELECT id FROM yk_payments WHERE applied = 0 AND status != 'canceled' AND created_at >= ?"
    args = [since]
    if user_id is not None:
        sql += " AND user_id = ?"
        args.append(user_id)
    conn = storage.connect()
    ids = [r[0] for r in conn.execute(sql, args).fetchall()]
    conn.close()
    return ids


async def sync_pending(user_id: int = None) -> list:
    """Перепроверяет неначисленные платежи (на случай, если уведомление ЮKassa
    не дошло или не настроено). → новые начисления."""
    if not enabled():
        return []
    out = []
    for pid in pending_ids(user_id):
        try:
            res = await sync(pid)
        except Exception as e:  # один сбойный платёж не мешает остальным
            print(f"YooKassa sync {pid} failed: {e}")
            continue
        if res and not res.get("duplicate"):
            out.append(res)
    return out

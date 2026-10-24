"""Premium и покупки: рубли через ЮKassa (Telegram Payments) и звёзды Telegram (XTR).

Рубли: Premium на месяц — 199 ₽. Включается переменной YOOKASSA_PROVIDER_TOKEN
(токен из @BotFather → Payments → ЮKassa). Если в магазине ЮKassa включена
отправка чеков (54-ФЗ), задайте YOOKASSA_RECEIPT=1 — в счёт уйдут данные чека,
а Telegram спросит у покупателя email для чека.
Звёзды: остальные товары, включаются PAYMENTS_ENABLED=1.

Оплата: мини-апп или бот создают счёт (invoice) → Telegram присылает
pre_checkout_query — проверяем validate_checkout → после оплаты приходит
successful_payment — apply_payment начисляет покупку ровно один раз
(charge_id уникален, повторная доставка ничего не удвоит).
"""

import json
import os
from datetime import date, datetime, timedelta

import game
import storage

CURRENCY = "XTR"
YOOKASSA_TOKEN = os.getenv("YOOKASSA_PROVIDER_TOKEN", "").strip()
YOOKASSA_RECEIPT = os.getenv("YOOKASSA_RECEIPT", "") == "1"
YOOKASSA_VAT_CODE = int(os.getenv("YOOKASSA_VAT_CODE", "1") or 1)  # 1 — без НДС
RUB_PRICES = {"premium_month": 19900}  # в копейках: 199 ₽

# id → название, цена в звёздах, дни Premium (если это Premium)
PRODUCTS = {
    "premium_month": {"title": "LifeQuest Premium · 30 дней", "stars": 149, "days": 30,
                      "description": "Случайные квесты, все наборы квестов, больше фото, 2 заморозки в неделю, "
                                     "все маскоты, эксклюзивные аксессуары и стили."},
    "premium_year": {"title": "LifeQuest Premium · год", "stars": 990, "days": 365,
                     "description": "Всё из Premium на 12 месяцев — выгоднее помесячной на 45%."},
    "freeze": {"title": "Заморозка серии", "stars": 25,
               "description": "Спасёт серию за один пропущенный день. Срабатывает сама."},
    "streak_restore": {"title": "Вернуть серию", "stars": 49,
                       "description": "Серия продолжится с того же числа, как будто пропуска не было."},
}
PREMIUM_PRODUCTS = {"premium_month", "premium_year"}
FIRST_PURCHASE_PRICE = {"premium_month": 75}  # −50% на первую покупку
TRIAL_DAYS = 7
TRIAL_AFTER_QUESTS = 3  # пробная неделя открывается после 3 выполненных квестов…
TRIAL_AFTER_HABIT_DAYS = 3  # …или после 3 дней с выполненными привычками — главное действие
RESTORE_MIN_STREAK = 3
RESTORE_MAX_MISSED = 3  # вернуть серию можно, пока пропущено не больше 3 дней


def _now() -> datetime:
    return datetime.utcnow()


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def paid_before(user_id: int) -> bool:
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM payments WHERE user_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    return n > 0


def done_count(user_id: int) -> int:
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'",
                     (user_id,)).fetchone()[0]
    conn.close()
    return n


def habit_days(user_id: int) -> int:
    """В скольких днях выполнена хотя бы одна привычка."""
    conn = storage.connect()
    n = conn.execute("SELECT COUNT(DISTINCT local_date) FROM habit_logs WHERE user_id = ? AND done = 1",
                     (user_id,)).fetchone()[0]
    conn.close()
    return n


def trial_earned(user_id: int) -> bool:
    return done_count(user_id) >= TRIAL_AFTER_QUESTS or habit_days(user_id) >= TRIAL_AFTER_HABIT_DAYS


def trial_available(user: dict) -> bool:
    return not user.get("trial_used") and not game.is_premium(user) and trial_earned(user["user_id"])


def currencies(product: str) -> list:
    """Чем сейчас можно оплатить товар: рубли (если подключена ЮKassa и у товара
    есть цена в рублях) и/или звёзды (PAYMENTS_ENABLED=1). Рубли — первыми."""
    out = []
    if YOOKASSA_TOKEN and product in RUB_PRICES:
        out.append("RUB")
    if game.PAYMENTS_ENABLED and product in PRODUCTS:
        out.append(CURRENCY)
    return out


def currency_of(product: str, currency: str = None) -> str:
    """Валюта счёта: выбранная (если ею можно платить) или основная для товара."""
    options = currencies(product)
    if currency and currency.upper() in options:
        return currency.upper()
    if currency and options:
        raise game.QuestError("Этим способом товар сейчас не купить")
    return options[0] if options else CURRENCY


def buyable(product: str, currency: str = None) -> bool:
    """Можно ли сейчас купить товар (вообще или выбранной валютой)."""
    options = currencies(product)
    return bool(options) if currency is None else currency.upper() in options


def payments_enabled() -> bool:
    return any(buyable(p) for p in PRODUCTS)


def format_amount(amount: int, currency: str) -> str:
    return f"{amount // 100} ₽" if currency == "RUB" else f"{amount}⭐"


def price_text(user_id: int, product: str, currency: str = None) -> str:
    cur = currency_of(product, currency)
    return format_amount(price(user_id, product, cur), cur)


def price(user_id: int, product: str, currency: str = CURRENCY) -> int:
    """Цена в единицах счёта: копейки для рублей, штуки для звёзд."""
    if product not in PRODUCTS:
        raise game.QuestError("Такого товара нет")
    if currency == "RUB":
        if product not in RUB_PRICES:
            raise game.QuestError("Этот товар продаётся только за звёзды")
        return RUB_PRICES[product]
    if product in FIRST_PURCHASE_PRICE and not paid_before(user_id):
        return FIRST_PURCHASE_PRICE[product]
    return PRODUCTS[product]["stars"]


def pay_options(user_id: int, product: str) -> list:
    """[{currency, amount, text}] — способы оплаты товара, основной первым."""
    return [{"currency": c, "amount": price(user_id, product, c), "text": format_amount(price(user_id, product, c), c)}
            for c in currencies(product)]


def restore_offer(user: dict, today: date = None):
    """Сколько дней серии можно вернуть за звёзды (0 — нельзя)."""
    today = today or game.local_today(user)
    s = game.user_streak(user, today)
    if s["status"] == "lost" and s["lost_value"] >= RESTORE_MIN_STREAK and 1 <= s["missed"] <= RESTORE_MAX_MISSED:
        return s["lost_value"]
    return 0


def premium_view(user: dict) -> dict:
    uid = user["user_id"]
    until = game.premium_until(user)
    return {
        "active": game.is_premium(user),
        "until": _fmt(until) if until and game.is_premium(user) and not game.premium_forever(user) else None,
        "forever": game.premium_forever(user),
        "trial_available": trial_available(user),
        "trial_used": bool(user.get("trial_used")),
        "trial_days": TRIAL_DAYS,
        "trial_after": TRIAL_AFTER_QUESTS,
        "trial_after_habit_days": TRIAL_AFTER_HABIT_DAYS,
        "prices": {p: price(uid, p) for p in PRODUCTS},
        "full_prices": {p: PRODUCTS[p]["stars"] for p in PRODUCTS},
        "options": {p: pay_options(uid, p) for p in PRODUCTS},
        "buyable": [p for p in PRODUCTS if buyable(p)],
        "restore": restore_offer(user) if game.PAYMENTS_ENABLED else 0,
        "payments": payments_enabled(),
    }


def check_purchase(user_id: int, product: str):
    """Можно ли купить сейчас — иначе QuestError с понятной причиной."""
    if product not in PRODUCTS:
        raise game.QuestError("Такого товара нет")
    user = storage.get_user(user_id)
    if not user:
        raise game.QuestError("Сначала открой бота: /start")
    if product == "freeze" and (user.get("freeze_tokens") or 0) >= game.FREEZE_MAX:
        raise game.QuestError(f"Больше {game.FREEZE_MAX} заморозок не помещается в морозилку 🧊")
    if product == "streak_restore" and not restore_offer(user):
        raise game.QuestError("Эту серию уже не вернуть — но новая начинается сегодня 🌱")
    if product in PREMIUM_PRODUCTS and game.premium_forever(user):
        raise game.QuestError("У тебя уже Premium навсегда 💛")


def make_payload(user_id: int, product: str, currency: str = CURRENCY) -> str:
    return f"{product}:{user_id}:{price(user_id, product, currency)}:{currency}"


def parse_payload(payload: str):
    """→ (товар, user_id, сумма, валюта). Старые счета без валюты — звёздные."""
    try:
        parts = payload.split(":")
        if len(parts) == 3:
            parts.append(CURRENCY)
        product, uid, amount, currency = parts
        return product, int(uid), int(amount), currency
    except (AttributeError, ValueError):
        raise game.QuestError("Счёт устарел — открой его заново")


def invoice_params(user_id: int, product: str, currency: str = None) -> dict:
    """Параметры для bot.create_invoice_link / bot.send_invoice (extra — именованные
    аргументы для рублёвого счёта: email и данные чека для ЮKassa)."""
    if product in PRODUCTS and not buyable(product):
        raise game.QuestError("Оплата скоро появится — мы уже готовим 💛", code="payments_off")
    check_purchase(user_id, product)
    cur = currency_of(product, currency)
    p = PRODUCTS[product]
    amount = price(user_id, product, cur)
    out = {"title": p["title"], "description": p["description"], "payload": make_payload(user_id, product, cur),
           "currency": cur, "amount": amount, "stars": amount, "provider_token": "", "extra": {}}
    if out["currency"] == "RUB":
        out["provider_token"] = YOOKASSA_TOKEN
        if YOOKASSA_RECEIPT:
            receipt = {"receipt": {"items": [{
                "description": p["title"][:128], "quantity": "1.00",
                "amount": {"value": f"{amount / 100:.2f}", "currency": "RUB"},
                "vat_code": YOOKASSA_VAT_CODE, "payment_mode": "full_payment", "payment_subject": "service"}]}}
            out["extra"] = {"need_email": True, "send_email_to_provider": True, "provider_data": json.dumps(receipt)}
    return out


def validate_checkout(user_id: int, payload: str, total: int, currency: str):
    product, uid, amount, cur = parse_payload(payload)
    if uid != user_id or product not in PRODUCTS or currency != cur or total != amount:
        raise game.QuestError("Счёт устарел — открой его заново")
    check_purchase(user_id, product)
    return product


def _extend_premium(conn, user: dict, days: int) -> str:
    start = max(_now(), game.premium_until(user) or _now())
    until = _fmt(start + timedelta(days=days))
    conn.execute("UPDATE users SET premium_until = ?, premium_notice = NULL WHERE user_id = ?",
                 (until, user["user_id"]))
    return until


def apply_payment(user_id: int, payload: str, charge_id: str, total: int, currency: str = CURRENCY) -> dict:
    """Начисляет покупку. Повторный вызов с тем же charge_id → {"duplicate": True}.
    total — в единицах счёта (копейки для рублей, штуки для звёзд)."""
    product = parse_payload(payload)[0]
    if product not in PRODUCTS:
        raise game.QuestError("Неизвестный товар")
    storage.ensure_user(user_id)
    conn = storage.connect()
    cur = conn.execute("""INSERT OR IGNORE INTO payments (user_id, product, stars, charge_id, created_at, currency)
                          VALUES (?, ?, ?, ?, ?, ?)""", (user_id, product, total, charge_id, storage.utc_now_str(), currency))
    if cur.rowcount != 1:
        conn.close()
        return {"product": product, "duplicate": True}
    user = storage.get_user(user_id)
    result = {"product": product, "duplicate": False}
    if product in PREMIUM_PRODUCTS:
        result["until"] = _extend_premium(conn, user, PRODUCTS[product]["days"])
    elif product == "freeze":
        conn.execute("UPDATE users SET freeze_tokens = COALESCE(freeze_tokens, 0) + 1 WHERE user_id = ?", (user_id,))
    elif product == "streak_restore":
        restored = restore_offer(user)
        if restored:
            yesterday = (game.local_today(user) - timedelta(days=1)).isoformat()
            conn.execute("UPDATE users SET streak_last_date = ? WHERE user_id = ?", (yesterday, user_id))
            result["streak"] = restored
        else:  # успели начать новую серию, пока шла оплата — не теряем звёзды
            conn.execute("UPDATE users SET freeze_tokens = COALESCE(freeze_tokens, 0) + 2 WHERE user_id = ?",
                         (user_id,))
            result["compensation"] = "freeze2"
    conn.commit()
    conn.close()
    return result


def start_trial(user_id: int) -> str:
    user = storage.get_user(user_id)
    if user.get("trial_used"):
        raise game.QuestError("Пробная неделя уже была 🙂")
    if game.is_premium(user):
        raise game.QuestError("Premium уже активен")
    if not trial_earned(user_id):
        raise game.QuestError(f"Пробная неделя откроется после {TRIAL_AFTER_HABIT_DAYS} дней с привычками")
    until = _fmt(_now() + timedelta(days=TRIAL_DAYS))
    storage.update_user(user_id, premium_until=until, trial_used=1, premium_notice=None)
    return until


def grant(user_id: int, days: int) -> str:
    """Подарок от админа: продлевает Premium на days дней."""
    storage.ensure_user(user_id)
    conn = storage.connect()
    until = _extend_premium(conn, storage.get_user(user_id), days)
    conn.commit()
    conn.close()
    return until


def mark_refunded(charge_id: str):
    """После возврата звёзд забираем то, что было куплено (Premium — сокращаем срок)."""
    conn = storage.connect(rows=True)
    row = conn.execute("SELECT * FROM payments WHERE charge_id = ? AND refunded = 0", (charge_id,)).fetchone()
    if not row:
        conn.close()
        raise game.QuestError("Платёж не найден или уже возвращён")
    conn.execute("UPDATE payments SET refunded = 1 WHERE id = ?", (row["id"],))
    user = storage.get_user(row["user_id"])
    if row["product"] in PREMIUM_PRODUCTS:
        until = game.premium_until(user)
        if until:
            new = until - timedelta(days=PRODUCTS[row["product"]]["days"])
            conn.execute("UPDATE users SET premium_until = ? WHERE user_id = ?", (_fmt(new), row["user_id"]))
    elif row["product"] == "freeze":
        conn.execute("UPDATE users SET freeze_tokens = MAX(0, COALESCE(freeze_tokens, 0) - 1) WHERE user_id = ?",
                     (row["user_id"],))
    conn.commit()
    conn.close()
    return dict(row)


def users_for_premium_notice():
    """[(user_id, kind)] — kind: 'soon' (осталось ≤2 дней) или 'ended' (закончился за сутки)."""
    now = _now()
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT user_id, premium_until, premium_notice, trial_used FROM users
                           WHERE premium_until IS NOT NULL AND COALESCE(blocked, 0) = 0
                             AND COALESCE(is_premium, 0) = 0""").fetchall()
    conn.close()
    out = []
    for r in rows:
        until = game.premium_until(dict(r))
        if not until:
            continue
        if now < until <= now + timedelta(days=2) and r["premium_notice"] != f"soon:{r['premium_until']}":
            out.append((r["user_id"], "soon", r["premium_until"]))
        elif until <= now < until + timedelta(days=1) and r["premium_notice"] != f"ended:{r['premium_until']}":
            out.append((r["user_id"], "ended", r["premium_until"]))
    return out


def mark_notice(user_id: int, kind: str, until: str):
    storage.update_user(user_id, premium_notice=f"{kind}:{until}")


def stats() -> dict:
    conn = storage.connect()
    active = conn.execute("SELECT COUNT(*) FROM users WHERE COALESCE(is_premium, 0) = 1 OR premium_until > ?",
                          (storage.utc_now_str(),)).fetchone()[0]
    since = _fmt(_now() - timedelta(days=30))
    count = conn.execute("SELECT COUNT(*) FROM payments WHERE refunded = 0").fetchone()[0]
    sums = {}
    for cur, period in (("XTR", None), ("XTR", since), ("RUB", None), ("RUB", since)):
        sums[(cur, period)] = conn.execute(
            "SELECT COALESCE(SUM(stars), 0) FROM payments WHERE refunded = 0 AND COALESCE(currency, 'XTR') = ?"
            + (" AND created_at >= ?" if period else ""), (cur, period) if period else (cur,)).fetchone()[0]
    stars, month = sums[("XTR", None)], sums[("XTR", since)]
    rub, rub_month = sums[("RUB", None)] // 100, sums[("RUB", since)] // 100
    trials = conn.execute("SELECT COUNT(*) FROM users WHERE trial_used = 1").fetchone()[0]
    conn.close()
    return {"active": active, "stars": stars, "payments": count, "stars_30d": month, "trials": trials,
            "rub": rub, "rub_30d": rub_month}

"""Приз дня (автомат с хваталкой): открывается, когда сделаны 3 привычки на
сегодня (или все, если их меньше). Один приз в день. Первые 7 сундуков — вещи: шапочки,
осенний набор для маскота и закрытый стиль приложения; дальше 70% — звёздочки XP
(иногда заморозка), 30% — вещь для маскота. В витрине лежат капсулы с вещами,
которых у игрока ещё нет; выпала вещь — достаётся та капсула, которую ловили (pick)."""
import json
import random

import game
import habits
import storage

CHEST_NEED = 3
# (вес, награда)
REWARDS = [
    (55, {"kind": "xp", "amount": 20}),
    (25, {"kind": "xp", "amount": 35}),
    (12, {"kind": "freeze", "amount": 1}),
    (8, {"kind": "xp", "amount": 75, "jackpot": True}),
]


def status(user_id: int, summary: dict = None) -> dict:
    s = summary or habits.summary(user_id)
    user = storage.get_user(user_id) or {}
    today = game.local_today(user).isoformat()
    need = min(CHEST_NEED, s["total"])
    opened = user.get("chest_day") == today
    reward = None
    if opened and user.get("chest_reward"):
        try:
            reward = json.loads(user["chest_reward"])
        except ValueError:
            reward = None
    ready = bool(need) and s["done"] >= need and not opened
    return {"need": need, "have": min(s["done"], need) if need else 0, "ready": ready,
            "opened": opened, "reward": reward, "machine": _machine_pool(user) if ready else []}


def _roll(user: dict, rng) -> dict:
    total = sum(w for w, _ in REWARDS)
    x = rng.uniform(0, total)
    for w, r in REWARDS:
        x -= w
        if x <= 0:
            break
    reward = dict(r)
    if reward["kind"] == "freeze" and (user.get("freeze_tokens") or 0) >= game.FREEZE_MAX:
        reward = {"kind": "xp", "amount": 35}
    return reward


# Первая неделя: что лежит в 1-м, 2-м, … 7-м сундуке
WEEK_ONE = ("autumn", "hat", "style", "autumn", "hat", "autumn", "hat")
HATS = ("cap", "beanie", "beret", "party", "cowboy", "chef", "graduate", "tophat", "crown")
STYLES = ("ocean", "forest", "matrix")  # закрытые стили, которые может подарить сундук


def _item_name(item: str) -> str:
    for a in (*game.ACCESSORIES, *game.SEASONAL_ACCESSORIES):
        if a[0] == item:
            return a[1]
    return item


def _week_one(user: dict, rng, pick: str = None) -> dict:
    """Вещь для одного из первых семи сундуков (только то, чего ещё нет)."""
    owned = game.owned_with_gifts(user)
    slot = WEEK_ONE[min(len(WEEK_ONE) - 1, user.get("chest_opens") or 0)]
    pools = {"autumn": game.AUTUMN_ACCESSORIES, "hat": HATS}
    styles = [] if game.is_premium(user) else [t for t in STYLES if f"theme:{t}" not in owned]
    theme_names = {k: n for k, n, _d in game.THEMES}
    order = [slot] + [k for k in ("autumn", "hat", "style") if k != slot]
    for kind in order:
        if kind == "style":
            if styles:
                t = styles[0]
                return {"kind": "theme", "id": t, "name": theme_names[t], "item": f"theme:{t}"}
            continue
        left = [x for x in pools[kind] if x not in owned]
        if left:
            # поймали капсулу с вещью, которой ещё нет, — её и отдаём
            item = pick if pick and pick in _machine_pool(user) else rng.choice(left)
            return {"kind": "accessory", "id": item, "name": _item_name(item), "item": item}
    return {"kind": "xp", "amount": 35}


MERCH_SHARE = 0.3  # доля призов-вещей в автомате (остальное — звёздочки XP или заморозка)


def _machine_pool(user: dict) -> list:
    """Что лежит в капсулах: шапочки и наряды для маскота, которых ещё нет."""
    owned = game.owned_items(user["user_id"])
    today = game.local_today(user)
    pool = [a[0] for a in game.ACCESSORIES]
    pool += [a[0] for a in game.SEASONAL_ACCESSORIES if game._in_season(a[3], a[4], today)]
    return [x for x in pool if x not in owned]


def _machine_prize(user: dict, rng, pick: str = None):
    """Автомат с призами: пойманная капсула (pick), если такой вещи ещё нет,
    иначе случайная. Собрана вся коллекция — None (тогда XP или заморозка)."""
    left = _machine_pool(user)
    if not left:
        return None
    item = pick if pick in left else rng.choice(left)
    return {"kind": "accessory", "id": item, "name": _item_name(item), "item": item}


def open_chest(user_id: int, rng=random, pick: str = None) -> dict:
    st = status(user_id)
    if st["opened"]:
        raise game.QuestError("Сундук на сегодня уже открыт — завтра будет новый 🎁")
    if not st["ready"]:
        left = st["need"] - st["have"]
        raise game.QuestError(f"Ещё {left} — и сундук откроется" if st["need"] else "Сначала заведи привычки — сундук за них")
    user = storage.get_user(user_id)
    today = game.local_today(user).isoformat()
    first_week = (user.get("chest_opens") or 0) < len(WEEK_ONE)
    if first_week:
        reward = _week_one(user, rng, pick)
    else:  # автомат: 30% — вещь для маскота, 70% — звёздочка XP (иногда заморозка)
        reward = (_machine_prize(user, rng, pick) if rng.random() < MERCH_SHARE else None) or _roll(user, rng)
    conn = storage.connect()
    cur = conn.execute("""UPDATE users SET chest_day = ?, chest_reward = ?, chest_opens = COALESCE(chest_opens, 0) + 1
                          WHERE user_id = ? AND COALESCE(chest_day, '') <> ?""",
                       (today, json.dumps(reward), user_id, today))
    if cur.rowcount and reward["kind"] == "freeze":
        conn.execute("UPDATE users SET freeze_tokens = COALESCE(freeze_tokens, 0) + 1 WHERE user_id = ?", (user_id,))
    if cur.rowcount and reward.get("item"):
        conn.execute("INSERT INTO purchases (user_id, item, price, created_at) VALUES (?, ?, 0, ?)",
                     (user_id, reward["item"], storage.utc_now_str()))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise game.QuestError("Сундук на сегодня уже открыт — завтра будет новый 🎁")
    level_before = game.level_info(user.get("xp") or 0)["level"]
    if reward["kind"] == "xp":
        game.add_xp(user_id, reward["amount"], "chest", today)
    after = game.level_info(storage.get_user(user_id).get("xp") or 0)
    return {"reward": reward, "level_up": after if after["level"] > level_before else None,
            "chest": status(user_id)}

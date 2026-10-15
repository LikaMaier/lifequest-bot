"""Сундук дня: открывается, когда сделаны 3 привычки на сегодня (или все,
если их меньше). Внутри — XP или заморозка серии. Один сундук в день."""
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
    return {"need": need, "have": min(s["done"], need) if need else 0, "ready": bool(need) and s["done"] >= need and not opened,
            "opened": opened, "reward": reward}


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


def open_chest(user_id: int, rng=random) -> dict:
    st = status(user_id)
    if st["opened"]:
        raise game.QuestError("Сундук на сегодня уже открыт — завтра будет новый 🎁")
    if not st["ready"]:
        left = st["need"] - st["have"]
        raise game.QuestError(f"Ещё {left} — и сундук откроется" if st["need"] else "Сначала заведи привычки — сундук за них")
    user = storage.get_user(user_id)
    today = game.local_today(user).isoformat()
    reward = _roll(user, rng)
    conn = storage.connect()
    cur = conn.execute("UPDATE users SET chest_day = ?, chest_reward = ? WHERE user_id = ? AND COALESCE(chest_day, '') <> ?",
                       (today, json.dumps(reward), user_id, today))
    if cur.rowcount and reward["kind"] == "freeze":
        conn.execute("UPDATE users SET freeze_tokens = COALESCE(freeze_tokens, 0) + 1 WHERE user_id = ?", (user_id,))
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

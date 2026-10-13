"""Друзья: приглашение по ссылке (обоим — заморозка серии в подарок),
список друзей с их серией и уровнем, приглашение на конкретный квест.

Ссылки бота: t.me/<bot>?start=ref_<user_id> — просто позвать;
t.me/<bot>?start=q_<quest_id>_<user_id> — позвать на квест."""

from datetime import timedelta

import game
import storage
from quests_database import CATALOG

FRIENDS_LIMIT = 200


def parse_start(payload: str):
    """'ref_123' → ('ref', None, 123); 'q_no_list_123' → ('q', 'no_list', 123); иначе None."""
    payload = (payload or "").strip()
    if payload.startswith("ref_") and payload[4:].isdigit():
        return "ref", None, int(payload[4:])
    if payload.startswith("q_"):
        quest, _, uid = payload[2:].rpartition("_")
        if uid.isdigit() and quest in CATALOG:
            return "q", quest, int(uid)
    return None


def are_friends(a: int, b: int) -> bool:
    conn = storage.connect()
    row = conn.execute("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?", (a, b)).fetchone()
    conn.close()
    return bool(row)


def add_friend(a: int, b: int) -> bool:
    """Дружба взаимная. True — если её не было."""
    if a == b or not storage.get_user(a) or not storage.get_user(b):
        return False
    conn = storage.connect()
    now = storage.utc_now_str()
    cur = conn.execute("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", (a, b, now))
    conn.execute("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", (b, a, now))
    conn.commit()
    conn.close()
    return cur.rowcount == 1


def _gift_freeze(user_id: int):
    conn = storage.connect()
    conn.execute("UPDATE users SET freeze_tokens = MIN(?, COALESCE(freeze_tokens, 0) + 1) WHERE user_id = ?",
                 (game.FREEZE_MAX, user_id))
    conn.commit()
    conn.close()


def handle_join(new_user_id: int, inviter_id: int, is_new: bool) -> dict:
    """Пришёл по ссылке друга. Подарки — только за новых людей и один раз."""
    if inviter_id == new_user_id or not storage.get_user(inviter_id):
        return {"ok": False}
    added = add_friend(new_user_id, inviter_id)
    gift = False
    if is_new and not storage.get_user(new_user_id).get("referred_by"):
        storage.update_user(new_user_id, referred_by=inviter_id)
        _gift_freeze(new_user_id)
        _gift_freeze(inviter_id)
        gift = True
    return {"ok": True, "added": added, "gift": gift}


def _public(user: dict) -> dict:
    s = game.user_streak(user, game.local_today(user))
    lv = game.level_info(user.get("xp") or 0)
    return {
        "id": user["user_id"], "name": user.get("first_name") or user.get("username") or "Друг",
        "mascot": game.LEGACY_MASCOTS.get(user.get("mascot"), user.get("mascot")) or "cat-purple",
        "accessory": game.visible_accessory(user),
        "streak": s["current"], "streak_today": s["status"] == "done",
        "level": lv["level"], "level_name": lv["name"],
    }


def list_view(user_id: int) -> dict:
    me = storage.get_user(user_id)
    today = game.local_today(me)
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT u.* FROM friends f JOIN users u ON u.user_id = f.friend_id
                           WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT ?""",
                        (user_id, FRIENDS_LIMIT)).fetchall()
    week_start = (today - timedelta(days=6)).isoformat()
    out = []
    for r in rows:
        item = _public(dict(r))
        item["week_done"] = conn.execute("""SELECT COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'
                                            AND local_date >= ?""", (r["user_id"], week_start)).fetchone()[0]
        out.append(item)
    my_week = conn.execute("""SELECT COUNT(*) FROM quest_history WHERE user_id = ? AND status = 'done'
                              AND local_date >= ?""", (user_id, week_start)).fetchone()[0]
    conn.close()
    out.sort(key=lambda f: (-f["week_done"], -f["streak"]))
    return {"friends": out, "me_week": my_week}


def remove(user_id: int, friend_id: int):
    conn = storage.connect()
    conn.execute("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
                 (user_id, friend_id, friend_id, user_id))
    conn.commit()
    conn.close()
    return list_view(user_id)

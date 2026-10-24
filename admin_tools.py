"""Разовые админские операции над данными (запускаются из бота один раз,
отметка — в таблице meta)."""

import game
import storage


def reset_xp(user_id: int):
    """Обнулить XP: баланс и историю начислений (уровень считается от XP)."""
    conn = storage.connect()
    conn.execute("UPDATE users SET xp = 0 WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM xp_log WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()


def remove_premium(user_id: int) -> bool:
    """Снять Premium, выданный в базе. False — если он «навсегда» через
    переменную PREMIUM_USER_IDS (её меняют в настройках Railway)."""
    storage.update_user(user_id, is_premium=0, premium_until=None)
    return user_id not in game.PREMIUM_USER_IDS


def friends_named(user_id: int, name: str) -> list:
    """Друзья пользователя с таким именем (без учёта регистра)."""
    conn = storage.connect()
    rows = conn.execute("""SELECT u.user_id, u.first_name FROM friends f JOIN users u ON u.user_id = f.friend_id
                           WHERE f.user_id = ?""", (user_id,)).fetchall()
    conn.close()
    return [r[0] for r in rows if (r[1] or "").strip().lower() == name.lower()]


def owner_free_view(owner_id: int, friend_name: str = "Алексей") -> str:
    """Владелице: снять Premium и обнулить XP; другу с именем friend_name — обнулить XP.
    Возвращает отчёт для сообщения владелице."""
    lines = []
    if remove_premium(owner_id):
        lines.append("👑 Premium снят — приложение теперь выглядит как у всех.")
    else:
        lines.append("👑 Premium в базе снят, но твой id есть в переменной PREMIUM_USER_IDS на Railway — "
                     "убери его оттуда, чтобы Premium пропал совсем.")
    reset_xp(owner_id)
    lines.append("⭐ Твой XP обнулён.")
    found = friends_named(owner_id, friend_name)
    if len(found) == 1:
        reset_xp(found[0])
        lines.append(f"⭐ XP у {friend_name} обнулён.")
    elif not found:
        lines.append(f"🤷 Среди друзей не нашёлся «{friend_name}» — его XP не трогала.")
    else:
        lines.append(f"🤷 Друзей с именем «{friend_name}» несколько ({', '.join(map(str, found))}) — XP не трогала.")
    return "\n".join(lines)


REVOKED_KEY = "premium_revoked_ids"


def revoked_ids() -> set:
    conn = storage.connect()
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (REVOKED_KEY,)).fetchone()
    conn.close()
    return {int(x) for x in (row[0] if row else "").split() if x.isdigit()}


def apply_premium_revocations():
    """Снятый навсегда Premium перекрывает переменную PREMIUM_USER_IDS — вызывать при старте."""
    game.PREMIUM_USER_IDS.difference_update(revoked_ids())


def revoke_premium_forever(user_id: int):
    """Снять Premium совсем: «навсегда» (и из PREMIUM_USER_IDS), срок и пробную неделю.
    Вернуть можно командой /grant user_id дней."""
    storage.update_user(user_id, is_premium=0, premium_until=None, trial_used=1, premium_notice=None)
    ids = revoked_ids() | {user_id}
    conn = storage.connect()
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                 (REVOKED_KEY, " ".join(map(str, sorted(ids)))))
    conn.commit()
    conn.close()
    apply_premium_revocations()

"""Сферы привычек пользователя.

С банком привычек v2 стандартные сферы привычек — 8 сфер из habits_bank.py
(body, food, sleep, …). Пользователь включает нужные (на старте 2–3, потом
в настройках сфер); включённая сфера — строка в user_spheres с её ключом.
Прежние 6 сфер (они же сферы квестов: «Энергия», «Дисциплина»…) остаются
только у тех, кто пользовался приложением до v2 (users.legacy_spheres) —
их привычки и статистика не ломаются. Сферы квестов при этом не меняются.

Стандартные можно переименовать, сменить эмодзи и цвет — ключ остаётся
прежним. Свои сферы получают ключ вида «c<id>». Удалить можно любую: у
привычек сфера тогда просто сбрасывается (прежняя помечается hidden,
сфера банка выключается — её можно включить снова)."""

import game
import habit_catalog
import storage
from quests_database import BINGO_SPHERES

DEFAULTS = {  # ключ: (эмодзи, цвет)
    "Дисциплина": ("🛡️", "blue"),
    "Энергия": ("🔋", "lime"),
    "Саморазвитие": ("📚", "yellow"),
    "Смелость": ("🦁", "red"),
    "Приключения": ("🧭", "lav"),
    "Творчество": ("🎨", "pink"),
}
BANK = {sp["key"]: sp for sp in habit_catalog.spheres()}  # 8 сфер банка привычек v2
COLORS = ("blue", "pink", "yellow", "lav", "red", "orange", "purple", "lime")
CUSTOM_LIMIT = 12
NAME_MAX = 24
EMOJI_MAX = 8


def _rows(user_id: int) -> dict:
    conn = storage.connect(rows=True)
    rows = conn.execute("SELECT * FROM user_spheres WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
    conn.close()
    return {r["key"]: dict(r) for r in rows}


def _custom(key: str) -> bool:
    """Своя сфера: ключ «c<id>» (не путать с creative/calm из банка)."""
    return key[:1] == "c" and key[1:].isdigit()


def _legacy(user_id: int) -> bool:
    return bool((storage.get_user(user_id) or {}).get("legacy_spheres"))


def list_spheres(user_id: int) -> list:
    rows = _rows(user_id)
    out = []
    for key in BINGO_SPHERES if _legacy(user_id) else ():
        emoji, color = DEFAULTS[key]
        r = rows.get(key) or {}
        if r.get("hidden"):
            continue
        out.append({"key": key, "name": r.get("name") or key, "emoji": r.get("emoji") or emoji,
                    "color": r.get("color") or color, "custom": False})
    for key, sp in BANK.items():
        r = rows.get(key)
        if r is None or r.get("hidden"):
            continue
        out.append({"key": key, "name": r.get("name") or sp["name"], "emoji": r.get("emoji") or sp["emoji"],
                    "color": r.get("color") or sp["color"], "custom": False})
    for key, r in rows.items():
        if _custom(key):
            out.append({"key": key, "name": r["name"], "emoji": r["emoji"] or "⭐", "color": r["color"] or "lav",
                        "custom": True})
    return out


def available(user_id: int) -> list:
    """Сферы банка, которые ещё не включены, — их можно добавить."""
    on = keys(user_id)
    return [dict(sp) for k, sp in BANK.items() if k not in on]


def enable(user_id: int, wanted) -> list:
    """Включить сферы банка (на старте или позже в настройках). Повторно — без вреда."""
    wanted = [k for k in (wanted or []) if k in BANK]
    if not wanted:
        raise game.QuestError("Выбери хотя бы одну сферу")
    conn = storage.connect()
    for key in wanted:
        if conn.execute("SELECT 1 FROM user_spheres WHERE user_id = ? AND key = ?", (user_id, key)).fetchone():
            conn.execute("UPDATE user_spheres SET hidden = 0 WHERE user_id = ? AND key = ?", (user_id, key))
        else:
            conn.execute("INSERT INTO user_spheres (user_id, key) VALUES (?, ?)", (user_id, key))
    conn.commit()
    conn.close()
    return list_spheres(user_id)


def keys(user_id: int) -> set:
    return {s["key"] for s in list_spheres(user_id)}


def _clean(data: dict, partial: bool) -> dict:
    f = {}
    if not partial or "name" in data:
        name = " ".join(str(data.get("name") or "").split())[:NAME_MAX]
        if not name:
            raise game.QuestError("Напиши название сферы")
        f["name"] = name
    if not partial or "emoji" in data:
        f["emoji"] = " ".join(str(data.get("emoji") or "").split())[:EMOJI_MAX] or "⭐"
    if not partial or "color" in data:
        f["color"] = data.get("color") if data.get("color") in COLORS else "lav"
    return f


def create(user_id: int, data: dict) -> list:
    f = _clean(data, partial=False)
    if any(s["name"].lower() == f["name"].lower() for s in list_spheres(user_id)):
        raise game.QuestError("Такая сфера уже есть")
    conn = storage.connect()
    n = sum(1 for r in conn.execute("SELECT key FROM user_spheres WHERE user_id = ?", (user_id,)).fetchall() if _custom(r[0]))
    if n >= CUSTOM_LIMIT:
        conn.close()
        raise game.QuestError(f"Своих сфер уже {CUSTOM_LIMIT} — это максимум")
    cur = conn.execute("INSERT INTO user_spheres (user_id, key, name, emoji, color) VALUES (?, '', ?, ?, ?)",
                       (user_id, f["name"], f["emoji"], f["color"]))
    conn.execute("UPDATE user_spheres SET key = ? WHERE id = ?", (f"c{cur.lastrowid}", cur.lastrowid))
    conn.commit()
    conn.close()
    return list_spheres(user_id)


def update(user_id: int, key: str, data: dict) -> list:
    if key not in keys(user_id):
        raise game.QuestError("Такой сферы нет")
    f = _clean(data, partial=True)
    if not f:
        return list_spheres(user_id)
    if "name" in f and any(s["name"].lower() == f["name"].lower() and s["key"] != key for s in list_spheres(user_id)):
        raise game.QuestError("Такая сфера уже есть")
    conn = storage.connect()
    if not conn.execute("SELECT 1 FROM user_spheres WHERE user_id = ? AND key = ?", (user_id, key)).fetchone():
        conn.execute("INSERT INTO user_spheres (user_id, key) VALUES (?, ?)", (user_id, key))  # стандартная: своя версия
    conn.execute(f"UPDATE user_spheres SET {', '.join(f'{k} = ?' for k in f)} WHERE user_id = ? AND key = ?",
                 (*f.values(), user_id, key))
    conn.commit()
    conn.close()
    return list_spheres(user_id)


def reset(user_id: int, key: str) -> list:
    """Стандартная сфера — вернуть исходные название, эмодзи и цвет."""
    if key not in DEFAULTS and key not in BANK:
        raise game.QuestError("Вернуть как было можно только стандартную сферу")
    conn = storage.connect()
    if key in BANK:  # строка сферы банка = «включена», её не удаляем
        conn.execute("UPDATE user_spheres SET name = NULL, emoji = NULL, color = NULL WHERE user_id = ? AND key = ?",
                     (user_id, key))
    else:
        conn.execute("DELETE FROM user_spheres WHERE user_id = ? AND key = ?", (user_id, key))
    conn.commit()
    conn.close()
    return list_spheres(user_id)


def delete(user_id: int, key: str) -> list:
    if key not in keys(user_id):
        raise game.QuestError("Такой сферы нет")
    conn = storage.connect()
    if key in DEFAULTS:  # прежняя стандартная зашита в каталог квестов — её просто прячем
        if not conn.execute("SELECT 1 FROM user_spheres WHERE user_id = ? AND key = ?", (user_id, key)).fetchone():
            conn.execute("INSERT INTO user_spheres (user_id, key) VALUES (?, ?)", (user_id, key))
        cur = conn.execute("UPDATE user_spheres SET hidden = 1 WHERE user_id = ? AND key = ?", (user_id, key))
    else:
        cur = conn.execute("DELETE FROM user_spheres WHERE user_id = ? AND key = ?", (user_id, key))
    if cur.rowcount:
        conn.execute("UPDATE habits SET sphere = NULL WHERE user_id = ? AND sphere = ?", (user_id, key))
    conn.commit()
    conn.close()
    return list_spheres(user_id)

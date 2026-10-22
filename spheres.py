"""Сферы жизни пользователя: шесть стандартных (они же сферы квестов) и свои.

Стандартные можно переименовать, сменить эмодзи и цвет — ключ при этом
остаётся прежним («Энергия»), поэтому квесты продолжают считаться в ту же
сферу. Свои сферы получают ключ вида «c<id>». Удалить можно любую: у
привычек сфера тогда просто сбрасывается (стандартная помечается hidden)."""

import game
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
COLORS = ("blue", "pink", "yellow", "lav", "red", "orange", "purple", "lime")
CUSTOM_LIMIT = 12
NAME_MAX = 24
EMOJI_MAX = 8


def _rows(user_id: int) -> dict:
    conn = storage.connect(rows=True)
    rows = conn.execute("SELECT * FROM user_spheres WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
    conn.close()
    return {r["key"]: dict(r) for r in rows}


def list_spheres(user_id: int) -> list:
    rows = _rows(user_id)
    out = []
    for key in BINGO_SPHERES:
        emoji, color = DEFAULTS[key]
        r = rows.get(key) or {}
        if r.get("hidden"):
            continue
        out.append({"key": key, "name": r.get("name") or key, "emoji": r.get("emoji") or emoji,
                    "color": r.get("color") or color, "custom": False})
    for key, r in rows.items():
        if key.startswith("c"):
            out.append({"key": key, "name": r["name"], "emoji": r["emoji"] or "⭐", "color": r["color"] or "lav",
                        "custom": True})
    return out


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
    n = conn.execute("SELECT COUNT(*) FROM user_spheres WHERE user_id = ? AND key LIKE 'c%'", (user_id,)).fetchone()[0]
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
    """Стандартная сфера — вернуть исходные название, эмодзи и цвет (и вернуть удалённую)."""
    if key not in DEFAULTS:
        raise game.QuestError("Вернуть как было можно только стандартную сферу")
    conn = storage.connect()
    conn.execute("DELETE FROM user_spheres WHERE user_id = ? AND key = ?", (user_id, key))
    conn.commit()
    conn.close()
    return list_spheres(user_id)


def delete(user_id: int, key: str) -> list:
    if key not in keys(user_id):
        raise game.QuestError("Такой сферы нет")
    conn = storage.connect()
    if key in DEFAULTS:  # стандартная зашита в каталог квестов — её просто прячем
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

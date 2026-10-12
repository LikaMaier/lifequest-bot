"""Заметки: короткие записи на день — мысли, итоги, списки. Можно закрепить
и раскрасить как стикер. Видит только автор."""

from datetime import date

import game
import storage

MAX_TEXT = 4000
MAX_NOTES = 3000
COLORS = ("yellow", "pink", "blue", "lime", "lav", "orange")


def _clean(data: dict, partial: bool) -> dict:
    fields = {}
    if "text" in data or not partial:
        text = str(data.get("text") or "").strip()
        if not text:
            raise game.QuestError("Заметка пустая — напиши хоть пару слов")
        if len(text) > MAX_TEXT:
            raise game.QuestError(f"Слишком длинно: до {MAX_TEXT} символов")
        fields["text"] = text
    if data.get("day"):
        try:
            fields["day"] = date.fromisoformat(str(data["day"])[:10]).isoformat()
        except ValueError:
            raise game.QuestError("Некорректная дата")
    if "color" in data:
        fields["color"] = data["color"] if data["color"] in COLORS else "yellow"
    if "pinned" in data:
        fields["pinned"] = 1 if data["pinned"] else 0
    return fields


def _view(r) -> dict:
    return {"id": r["id"], "text": r["text"], "day": r["day"], "color": r["color"] or "yellow",
            "pinned": bool(r["pinned"]), "created_at": r["created_at"], "updated_at": r["updated_at"]}


def create_note(user_id: int, data: dict) -> dict:
    fields = _clean(data, partial=False)
    conn = storage.connect()
    if conn.execute("SELECT COUNT(*) FROM notes WHERE user_id = ?", (user_id,)).fetchone()[0] >= MAX_NOTES:
        conn.close()
        raise game.QuestError("Заметок очень много — удали старые, чтобы добавить новую")
    now = storage.utc_now_str()
    day = fields.get("day") or game.local_today(storage.get_user(user_id)).isoformat()
    cur = conn.execute("""INSERT INTO notes (user_id, text, day, color, pinned, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?)""",
                       (user_id, fields["text"], day, fields.get("color", "yellow"), fields.get("pinned", 0), now, now))
    conn.commit()
    conn.close()
    return get_note(user_id, cur.lastrowid)


def get_note(user_id: int, note_id: int) -> dict:
    conn = storage.connect(rows=True)
    r = conn.execute("SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id)).fetchone()
    conn.close()
    if not r:
        raise game.QuestError("Заметка не найдена")
    return _view(r)


def update_note(user_id: int, note_id: int, data: dict) -> dict:
    get_note(user_id, note_id)
    fields = _clean(data, partial=True)
    if fields:
        fields["updated_at"] = storage.utc_now_str()
        cols = ", ".join(f"{k} = ?" for k in fields)
        conn = storage.connect()
        conn.execute(f"UPDATE notes SET {cols} WHERE id = ? AND user_id = ?", (*fields.values(), note_id, user_id))
        conn.commit()
        conn.close()
    return get_note(user_id, note_id)


def delete_note(user_id: int, note_id: int) -> dict:
    conn = storage.connect()
    cur = conn.execute("DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise game.QuestError("Заметка не найдена")
    return {"ok": True}


def list_notes(user_id: int, day: str = None, q: str = None, limit: int = 50, offset: int = 0) -> dict:
    where, args = ["user_id = ?"], [user_id]
    if day:
        where.append("day = ?")
        args.append(str(day)[:10])
    if q:
        where.append("text LIKE ? ESCAPE '\\'")
        args.append("%" + str(q)[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    limit = max(1, min(200, int(limit or 50)))
    offset = max(0, int(offset or 0))
    sql_where = " AND ".join(where)
    conn = storage.connect(rows=True)
    total = conn.execute(f"SELECT COUNT(*) FROM notes WHERE {sql_where}", args).fetchone()[0]
    rows = conn.execute(f"""SELECT * FROM notes WHERE {sql_where}
                            ORDER BY pinned DESC, day DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?""",
                        (*args, limit, offset)).fetchall()
    conn.close()
    return {"notes": [_view(r) for r in rows], "total": total}


def home_view(user_id: int, today: date) -> dict:
    """Для главной: закреплённые и сегодняшние заметки (до 4) и общее число."""
    conn = storage.connect(rows=True)
    rows = conn.execute("""SELECT * FROM notes WHERE user_id = ? AND (pinned = 1 OR day = ?)
                           ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT 4""",
                        (user_id, today.isoformat())).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM notes WHERE user_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    return {"items": [_view(r) for r in rows], "total": total}

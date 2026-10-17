"""Общие фотоальбомы и доступ к своему альбому.

Общий альбом: создатель задаёт название, зовёт друзей (из списка друзей или
по ссылке t.me/<bot>?start=a_<id>). Все участники добавляют фото и видят
фото друг друга. Создатель может убрать любое фото и удалить альбом.

Доступ к моему альбому: владелец открывает выбранным друзьям просмотр своих
личных «Воспоминаний» (только смотреть — без правок). Доступ можно забрать.

Файлы фото по-прежнему лежат у загрузившего (photos.py); другим участникам
отдаются подписанные короткоживущие ссылки — только тем, у кого есть доступ.

Функции, которые должны что-то сообщить в Telegram, возвращают список
(user_id, text) — отправляет вызывающий код (бот или API)."""

import html

import friends
import game
import photos
import storage

ALBUMS_LIMIT = 10        # своих общих альбомов
MEMBERS_LIMIT = 30
EMOJI = ("📸", "🏖️", "🎉", "🎂", "🌲", "🍕", "✈️", "💛", "🐾", "🎄")


def _conn():
    return storage.connect(rows=True)


def _name(user_id: int) -> str:
    u = storage.get_user(user_id) or {}
    return u.get("first_name") or u.get("username") or "Друг"


def _album(album_id: int) -> dict:
    conn = _conn()
    r = conn.execute("SELECT * FROM shared_albums WHERE id = ?", (album_id,)).fetchone()
    conn.close()
    if not r:
        raise game.QuestError("Альбом не найден")
    return dict(r)


def member_ids(album_id: int) -> list:
    conn = _conn()
    rows = conn.execute("SELECT user_id FROM shared_album_members WHERE album_id = ? ORDER BY joined_at, user_id",
                        (album_id,)).fetchall()
    conn.close()
    return [r[0] for r in rows]


def is_member(album_id: int, user_id: int) -> bool:
    conn = _conn()
    row = conn.execute("SELECT 1 FROM shared_album_members WHERE album_id = ? AND user_id = ?",
                       (album_id, user_id)).fetchone()
    conn.close()
    return bool(row)


def _require_member(album_id: int, user_id: int) -> dict:
    a = _album(album_id)
    if not is_member(album_id, user_id):
        raise game.QuestError("Альбом не найден")
    return a


def _add_member(album_id: int, user_id: int) -> bool:
    conn = _conn()
    cur = conn.execute("INSERT OR IGNORE INTO shared_album_members (album_id, user_id, joined_at) VALUES (?, ?, ?)",
                       (album_id, user_id, storage.utc_now_str()))
    conn.commit()
    conn.close()
    return cur.rowcount == 1


def _title(a: dict) -> str:
    return f"{html.escape(a['emoji'] or '📸')} {html.escape(a['title'])}"


# ---------- общие альбомы ----------
def create(user_id: int, data: dict) -> dict:
    title = " ".join(str(data.get("title") or "").split())[:50]
    if not title:
        raise game.QuestError("Придумай название альбома")
    emoji = " ".join(str(data.get("emoji") or "").split())[:8] or "📸"
    conn = _conn()
    n = conn.execute("SELECT COUNT(*) FROM shared_albums WHERE owner_id = ?", (user_id,)).fetchone()[0]
    if n >= ALBUMS_LIMIT:
        conn.close()
        raise game.QuestError(f"Можно создать до {ALBUMS_LIMIT} общих альбомов")
    cur = conn.execute("INSERT INTO shared_albums (owner_id, title, emoji, created_at) VALUES (?, ?, ?, ?)",
                       (user_id, title, emoji, storage.utc_now_str()))
    conn.commit()
    album_id = cur.lastrowid
    conn.close()
    _add_member(album_id, user_id)
    return {"album": view(user_id, album_id)}


def public_invite(album_id: int) -> dict:
    a = _album(album_id)
    return {"id": a["id"], "title": a["title"], "emoji": a["emoji"], "owner_id": a["owner_id"]}


def join(user_id: int, album_id: int) -> dict:
    """Вход по ссылке-приглашению."""
    a = _album(album_id)
    if is_member(album_id, user_id):
        return {"album": view(user_id, album_id), "messages": [], "already": True}
    if len(member_ids(album_id)) >= MEMBERS_LIMIT:
        raise game.QuestError(f"В альбоме уже {MEMBERS_LIMIT} участников")
    if storage.get_user(a["owner_id"]):
        friends.add_friend(user_id, a["owner_id"])
    _add_member(album_id, user_id)
    note = f"📸 {html.escape(_name(user_id))} теперь в общем альбоме «{_title(a)}» — добавляйте фото вместе!"
    return {"album": view(user_id, album_id), "messages": [(a["owner_id"], note)]}


def invite(user_id: int, album_id: int, friend_id: int) -> dict:
    """Добавить друга сразу (любой участник может позвать своего друга)."""
    a = _require_member(album_id, user_id)
    if not friends.are_friends(user_id, friend_id):
        raise game.QuestError("Позвать можно только друга")
    if is_member(album_id, friend_id):
        raise game.QuestError("Этот друг уже в альбоме")
    if len(member_ids(album_id)) >= MEMBERS_LIMIT:
        raise game.QuestError(f"В альбоме уже {MEMBERS_LIMIT} участников")
    _add_member(album_id, friend_id)
    text = (f"📸 {html.escape(_name(user_id))} добавляет тебя в общий альбом «{_title(a)}». "
            f"Смотри фото и добавляй свои — раздел «Альбом» в приложении.")
    return {"album": view(user_id, album_id), "messages": [(friend_id, text)]}


def leave(user_id: int, album_id: int) -> dict:
    """Выйти из альбома; создатель — удаляет альбом целиком (со всеми фото в нём)."""
    a = _require_member(album_id, user_id)
    if a["owner_id"] == user_id:
        others = [uid for uid in member_ids(album_id) if uid != user_id]
        conn = _conn()
        rows = conn.execute("SELECT id, user_id FROM photos WHERE album_id = ?", (album_id,)).fetchall()
        conn.execute("DELETE FROM photos WHERE album_id = ?", (album_id,))
        conn.execute("DELETE FROM shared_album_members WHERE album_id = ?", (album_id,))
        conn.execute("DELETE FROM shared_albums WHERE id = ?", (album_id,))
        conn.commit()
        conn.close()
        for r in rows:
            photos._remove_files(r["user_id"], [r["id"]])
        msgs = [(uid, f"🗑 Общий альбом «{_title(a)}» удалён его создателем.") for uid in others]
        return {"ok": True, "deleted": True, "messages": msgs}
    conn = _conn()
    conn.execute("DELETE FROM shared_album_members WHERE album_id = ? AND user_id = ?", (album_id, user_id))
    conn.commit()
    conn.close()
    return {"ok": True, "messages": []}


def _cover(album_id: int):
    conn = _conn()
    r = conn.execute("SELECT id, user_id FROM photos WHERE album_id = ? ORDER BY created_at DESC LIMIT 1",
                     (album_id,)).fetchone()
    n = conn.execute("SELECT COUNT(*) FROM photos WHERE album_id = ?", (album_id,)).fetchone()[0]
    conn.close()
    return (photos.sign(r["user_id"], r["id"], "thumb") if r else None), n


def _member_view(uid: int) -> dict:
    user = storage.get_user(uid)
    if not user:
        return {"id": uid, "name": "Участник", "mascot": None, "accessory": None}
    pub = friends._public(user)
    return {"id": uid, "name": pub["name"], "mascot": pub["mascot"], "accessory": pub["accessory"]}


def _card(user_id: int, a: dict) -> dict:
    cover, n = _cover(a["id"])
    ids = member_ids(a["id"])
    return {"id": a["id"], "title": a["title"], "emoji": a["emoji"], "mine": a["owner_id"] == user_id,
            "owner": _name(a["owner_id"]), "count": n, "cover": cover, "members": len(ids)}


def view(user_id: int, album_id: int) -> dict:
    a = _require_member(album_id, user_id)
    rows = photos.list_album(album_id)
    names = {}
    out_photos = []
    for p in rows:
        uid = p.pop("_owner")
        names.setdefault(uid, _name(uid))
        p["by"] = "Ты" if uid == user_id else names[uid]
        p["mine"] = uid == user_id
        p["can_delete"] = uid == user_id or a["owner_id"] == user_id
        out_photos.append(p)
    return {**_card(user_id, a), "members_list": [_member_view(uid) for uid in member_ids(album_id)],
            "photos": out_photos, "owner_id": a["owner_id"]}


def delete_photo(user_id: int, album_id: int, photo_id: str) -> dict:
    """Своё фото удаляет автор, любое — создатель альбома."""
    a = _require_member(album_id, user_id)
    conn = _conn()
    r = conn.execute("SELECT user_id FROM photos WHERE id = ? AND album_id = ?", (photo_id, album_id)).fetchone()
    if not r or (r["user_id"] != user_id and a["owner_id"] != user_id):
        conn.close()
        raise game.QuestError("Фото не найдено")
    conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    conn.commit()
    conn.close()
    photos._remove_files(r["user_id"], [photo_id])
    return {"album": view(user_id, album_id)}


# ---------- доступ к моему альбому ----------
def can_view(viewer_id: int, owner_id: int) -> bool:
    conn = _conn()
    row = conn.execute("SELECT 1 FROM album_access WHERE owner_id = ? AND viewer_id = ?", (owner_id, viewer_id)).fetchone()
    conn.close()
    return bool(row)


def set_access(owner_id: int, friend_id: int, on: bool) -> dict:
    messages = []
    if on:
        if not friends.are_friends(owner_id, friend_id):
            raise game.QuestError("Открыть альбом можно только другу")
        conn = _conn()
        cur = conn.execute("INSERT OR IGNORE INTO album_access (owner_id, viewer_id, created_at) VALUES (?, ?, ?)",
                           (owner_id, friend_id, storage.utc_now_str()))
        conn.commit()
        conn.close()
        if cur.rowcount:
            messages.append((friend_id, f"🔓 {html.escape(_name(owner_id))} открывает тебе свой фотоальбом. "
                                        f"Загляни в приложение — раздел «Альбом»."))
    else:
        conn = _conn()
        conn.execute("DELETE FROM album_access WHERE owner_id = ? AND viewer_id = ?", (owner_id, friend_id))
        conn.commit()
        conn.close()
    return {"access": access_view(owner_id), "messages": messages}


def access_view(owner_id: int) -> list:
    """Друзья владельца с флагом «видит мой альбом»."""
    conn = _conn()
    granted = {r[0] for r in conn.execute("SELECT viewer_id FROM album_access WHERE owner_id = ?", (owner_id,)).fetchall()}
    rows = conn.execute("""SELECT friend_id FROM friends WHERE user_id = ? ORDER BY created_at DESC""",
                        (owner_id,)).fetchall()
    conn.close()
    out = []
    for r in rows:
        if storage.get_user(r[0]):
            out.append({**_member_view(r[0]), "on": r[0] in granted})
    return out


def friend_album(viewer_id: int, owner_id: int) -> dict:
    """Личный альбом друга — только если он открыл доступ. Только просмотр."""
    if not can_view(viewer_id, owner_id) or not storage.get_user(owner_id):
        raise game.QuestError("Друг пока не открыл тебе свой альбом")
    items = photos.list_photos(owner_id, {})
    for p in items:
        p["mine"] = False
        p["can_delete"] = False
        p["by"] = _name(owner_id)
    return {"owner": _member_view(owner_id), "photos": items}


def list_view(user_id: int) -> dict:
    conn = _conn()
    rows = [dict(r) for r in conn.execute("""SELECT a.* FROM shared_albums a JOIN shared_album_members m ON m.album_id = a.id
                                             WHERE m.user_id = ? ORDER BY a.id DESC""", (user_id,)).fetchall()]
    shared_with_me = [r[0] for r in conn.execute("SELECT owner_id FROM album_access WHERE viewer_id = ? ORDER BY created_at DESC",
                                                 (user_id,)).fetchall()]
    granted = conn.execute("SELECT COUNT(*) FROM album_access WHERE owner_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    friends_albums = []
    for oid in shared_with_me:
        if not storage.get_user(oid):
            continue
        c = _conn()
        r = c.execute("SELECT id FROM photos WHERE user_id = ? AND album_id IS NULL ORDER BY created_at DESC LIMIT 1",
                      (oid,)).fetchone()
        n = c.execute("SELECT COUNT(*) FROM photos WHERE user_id = ? AND album_id IS NULL", (oid,)).fetchone()[0]
        c.close()
        friends_albums.append({**_member_view(oid), "count": n,
                               "cover": photos.sign(oid, r["id"], "thumb") if r else None})
    return {"albums": [_card(user_id, a) for a in rows], "friends": friends_albums, "granted": granted,
            "emoji": list(EMOJI)}


def delete_user(user_id: int, conn):
    """Удаление данных пользователя: свои альбомы целиком, участие и доступы.
    Файлы своих фото удаляет photos.delete_all; фото других в его альбомах — здесь."""
    own = [r[0] for r in conn.execute("SELECT id FROM shared_albums WHERE owner_id = ?", (user_id,)).fetchall()]
    for aid in own:
        for r in conn.execute("SELECT id, user_id FROM photos WHERE album_id = ? AND user_id != ?", (aid, user_id)).fetchall():
            photos._remove_files(r[1], [r[0]])
        conn.execute("DELETE FROM photos WHERE album_id = ?", (aid,))
        conn.execute("DELETE FROM shared_album_members WHERE album_id = ?", (aid,))
        conn.execute("DELETE FROM shared_albums WHERE id = ?", (aid,))
    conn.execute("DELETE FROM shared_album_members WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM album_access WHERE owner_id = ? OR viewer_id = ?", (user_id, user_id))

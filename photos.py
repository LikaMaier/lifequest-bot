# ============================================================
# LIFEQUEST — фото
# Файлы хранятся на диске в PHOTOS_DIR (на Railway — внутри Volume, по
# умолчанию /data/photos), метаданные — в таблице photos. Имена файлов —
# случайные UUID. Отдаются только владельцу: по заголовку initData или по
# короткоживущей подписанной ссылке (HMAC, 10 минут) — её понимает <img>.
#
# Почему диск, а не Telegram (file_id в закрытом чате): миниатюры отдаются
# мгновенно с нашего сервера без getFile, удаление настоящее (файл исчезает,
# а в Telegram он остаётся на их серверах), метаданные и EXIF с геолокацией
# вырезаются при сохранении. Цена — место на Volume и отсутствие бэкапа.
# ============================================================

import hashlib
import hmac
import io
import os
import time
import uuid
from datetime import date

import game
import storage

PHOTOS_DIR = os.getenv("PHOTOS_DIR", "/data/photos")
MAX_BYTES = 5 * 1024 * 1024
MAX_SIDE = 1280
THUMB_SIDE = 320
PER_ITEM = 5
LIMIT_FREE = 200
LIMIT_PREMIUM = 1000
URL_TTL = 10 * 60
TARGETS = ("quest", "plan", "day", "board")

_secret = b""
_enabled = None


def configure(bot_token: str):
    global _secret
    _secret = hashlib.sha256(b"lifequest-photos:" + (bot_token or "").encode()).digest()


def enabled() -> bool:
    """Можно ли хранить фото: папка существует и в неё можно писать.
    Если нет (Volume не подключён) — фото выключаются, приложение работает."""
    global _enabled
    if _enabled is None:
        try:
            os.makedirs(PHOTOS_DIR, exist_ok=True)
            probe = os.path.join(PHOTOS_DIR, ".write-test")
            with open(probe, "w") as f:
                f.write("ok")
            os.remove(probe)
            _enabled = True
        except OSError as e:
            print(f"WARNING: фото выключены — PHOTOS_DIR={PHOTOS_DIR} недоступна для записи ({e}). "
                  "Подключите Railway Volume и задайте PHOTOS_DIR внутри него.")
            _enabled = False
    return _enabled


def reset_enabled_cache():
    global _enabled
    _enabled = None


def _sniff(raw: bytes) -> str:
    if raw[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return ""


def _paths(user_id: int, photo_id: str) -> tuple:
    folder = os.path.join(PHOTOS_DIR, str(int(user_id)))
    return folder, os.path.join(folder, f"{photo_id}.jpg"), os.path.join(folder, f"{photo_id}_t.jpg")


def limit_for(user: dict) -> int:
    return LIMIT_PREMIUM if user.get("is_premium") else LIMIT_FREE


# ==================== ПРИВЯЗКА ====================
def _target(user_id: int, data: dict) -> dict:
    kind = data.get("target")
    if kind not in TARGETS:
        raise game.QuestError("Непонятно, к чему прикрепить фото")
    conn = storage.connect(rows=True)
    try:
        if kind == "quest":
            hid = int(data.get("quest_history_id") or 0)
            row = conn.execute("SELECT id, local_date FROM quest_history WHERE id = ? AND user_id = ? AND status = 'done'",
                               (hid, user_id)).fetchone()
            if not row:
                raise game.QuestError("Фото можно прикрепить только к выполненному заданию")
            where, args = "quest_history_id = ?", (hid,)
            fields = {"quest_history_id": hid, "day": row["local_date"]}
        elif kind == "plan":
            pid = int(data.get("plan_id") or 0)
            import plans
            plan = plans._get(user_id, pid)
            d = plans.parse_date(data.get("plan_date") or plan["date"])
            if not plans.occurs_on(plan, d):
                raise game.QuestError("В этот день плана нет")
            where, args = "plan_id = ? AND plan_date = ?", (pid, d.isoformat())
            fields = {"plan_id": pid, "plan_date": d.isoformat()}
        elif kind == "day":
            d = date.fromisoformat(str(data.get("day"))[:10])
            if d > game.local_today(storage.get_user(user_id)):
                raise game.QuestError("Фото дня можно добавить только сегодня или в прошлое")
            where, args = "target_type = 'day' AND day = ?", (d.isoformat(),)
            fields = {"day": d.isoformat()}
        else:
            cell = int(data.get("board_cell"))
            if not 0 <= cell < storage.BOARD_CELLS:
                raise game.QuestError("Некорректная клетка карты")
            week = storage.get_current_week_key(game.local_today(storage.get_user(user_id)))
            where, args = "board_week = ? AND board_cell = ?", (week, cell)
            fields = {"board_week": week, "board_cell": cell}
        n = conn.execute(f"SELECT COUNT(*) FROM photos WHERE user_id = ? AND {where}", (user_id, *args)).fetchone()[0]
    except (TypeError, ValueError):
        raise game.QuestError("Некорректные данные")
    finally:
        conn.close()
    if n >= PER_ITEM:
        raise game.QuestError(f"Можно прикрепить до {PER_ITEM} фото")
    fields["target_type"] = kind
    return fields


# ==================== СОХРАНЕНИЕ ====================
def save_upload(user_id: int, raw: bytes, data: dict) -> dict:
    if not enabled():
        raise game.QuestError("Фото пока недоступны")
    if not raw:
        raise game.QuestError("Пустой файл")
    if len(raw) > MAX_BYTES:
        raise game.QuestError("Фото больше 5 МБ — выбери поменьше")
    if not _sniff(raw):
        raise game.QuestError("Подходят только JPEG, PNG или WebP")
    user = storage.get_user(user_id)
    conn = storage.connect()
    total = conn.execute("SELECT COUNT(*) FROM photos WHERE user_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    if total >= limit_for(user):
        raise game.QuestError(f"В альбоме уже {total} фото — это максимум. Удали старые, чтобы добавить новые.")
    fields = _target(user_id, data)

    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 40_000_000  # защита от «бомб» с гигантским разрешением
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")  # без альфы и без метаданных (EXIF, геолокация)
    except Exception:
        raise game.QuestError("Не получилось прочитать фото")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    photo_id = uuid.uuid4().hex
    folder, full, thumb = _paths(user_id, photo_id)
    os.makedirs(folder, exist_ok=True)
    img.save(full, "JPEG", quality=82, optimize=True, progressive=True)
    t = img.copy()
    t.thumbnail((THUMB_SIDE, THUMB_SIDE))
    t.save(thumb, "JPEG", quality=78, optimize=True)
    caption = " ".join(str(data.get("caption") or "").split())[:120]

    conn = storage.connect()
    cols = ["id", "user_id", "caption", "w", "h", "size", "created_at", *fields.keys()]
    conn.execute(f"INSERT INTO photos ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                 [photo_id, user_id, caption, img.width, img.height, os.path.getsize(full), storage.utc_now_str(),
                  *fields.values()])
    conn.commit()
    conn.close()
    return {"photo": view(user_id, photo_id), "new_achievements": game.check_achievements(user_id)}


# ==================== ССЫЛКИ ====================
def sign(user_id: int, photo_id: str, kind: str, exp: int = None) -> str:
    exp = exp or int(time.time()) + URL_TTL
    sig = hmac.new(_secret, f"{user_id}:{photo_id}:{kind}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"api/photos/{photo_id}/{kind}?u={user_id}&exp={exp}&sig={sig}"


def verify(user_id: int, photo_id: str, kind: str, exp: int, sig: str) -> bool:
    if not _secret or exp < time.time():
        return False
    good = hmac.new(_secret, f"{user_id}:{photo_id}:{kind}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(good, sig or "")


def file_path(user_id: int, photo_id: str, kind: str):
    """Путь к файлу, только если фото принадлежит пользователю."""
    if not photo_id.isalnum() or len(photo_id) != 32:
        return None
    conn = storage.connect()
    row = conn.execute("SELECT 1 FROM photos WHERE id = ? AND user_id = ?", (photo_id, user_id)).fetchone()
    conn.close()
    if not row:
        return None
    _folder, full, thumb = _paths(user_id, photo_id)
    path = thumb if kind == "thumb" else full
    return path if os.path.exists(path) else None


# ==================== ЧТЕНИЕ ====================
def _row_view(user_id: int, r: dict) -> dict:
    from quests_database import CATALOG
    label = r.get("caption") or ""
    if not label and r.get("quest_key"):
        q = CATALOG.get(r["quest_key"])
        label = f"{q['emoji']} {q['title']}" if q else (r.get("quest_title") or "")
    if not label and r.get("plan_title"):
        label = r["plan_title"]
    if not label and r["target_type"] == "board":
        label = "Карта недели"
    return {
        "id": r["id"], "target": r["target_type"], "quest_history_id": r["quest_history_id"],
        "plan_id": r["plan_id"], "plan_date": r["plan_date"], "day": r["day"] or r["plan_date"] or r["created_at"][:10],
        "board_cell": r["board_cell"], "w": r["w"], "h": r["h"], "label": label, "created_at": r["created_at"],
        "thumb": sign(user_id, r["id"], "thumb"), "url": sign(user_id, r["id"], "full"),
    }


_SELECT = """SELECT p.*, qh.quest_key AS quest_key, qh.title AS quest_title, pl.title AS plan_title
             FROM photos p
             LEFT JOIN quest_history qh ON qh.id = p.quest_history_id
             LEFT JOIN plans pl ON pl.id = p.plan_id
             WHERE p.user_id = ?"""


def view(user_id: int, photo_id: str) -> dict:
    conn = storage.connect(rows=True)
    r = conn.execute(_SELECT + " AND p.id = ?", (user_id, photo_id)).fetchone()
    conn.close()
    if not r:
        raise game.QuestError("Фото не найдено")
    return _row_view(user_id, dict(r))


def list_photos(user_id: int, filters: dict) -> list:
    where, args = [], []
    if filters.get("target") in TARGETS:
        where.append("p.target_type = ?")
        args.append(filters["target"])
    for key in ("quest_history_id", "plan_id", "board_cell"):
        if filters.get(key) not in (None, ""):
            try:
                args.append(int(filters[key]))
            except (TypeError, ValueError):
                raise game.QuestError("Некорректный фильтр")
            where.append(f"p.{key} = ?")
    if filters.get("plan_date"):
        where.append("p.plan_date = ?")
        args.append(str(filters["plan_date"])[:10])
    if filters.get("day"):
        where.append("COALESCE(p.day, p.plan_date) = ?")
        args.append(str(filters["day"])[:10])
    if filters.get("board_cell") not in (None, ""):
        where.append("p.board_week = ?")
        args.append(storage.get_current_week_key(game.local_today(storage.get_user(user_id))))
    sql = _SELECT + "".join(f" AND {w}" for w in where) + " ORDER BY p.created_at DESC, p.id LIMIT 500"
    conn = storage.connect(rows=True)
    rows = conn.execute(sql, (user_id, *args)).fetchall()
    conn.close()
    return [_row_view(user_id, dict(r)) for r in rows]


def stats(user_id: int) -> dict:
    conn = storage.connect()
    total = conn.execute("SELECT COUNT(*) FROM photos WHERE user_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    return {"enabled": enabled(), "count": total, "limit": limit_for(storage.get_user(user_id)), "per_item": PER_ITEM}


# ==================== УДАЛЕНИЕ ====================
def _remove_files(user_id: int, ids: list):
    for pid in ids:
        _folder, full, thumb = _paths(user_id, pid)
        for path in (full, thumb):
            try:
                os.remove(path)
            except OSError:
                pass


def delete_photo(user_id: int, photo_id: str) -> dict:
    conn = storage.connect()
    cur = conn.execute("DELETE FROM photos WHERE id = ? AND user_id = ?", (photo_id, user_id))
    conn.commit()
    conn.close()
    if not cur.rowcount:
        raise game.QuestError("Фото не найдено")
    _remove_files(user_id, [photo_id])
    return {"ok": True}


def delete_where(user_id: int, where: str, args: tuple) -> int:
    """Каскадное удаление фото (вызывается при удалении плана)."""
    conn = storage.connect()
    ids = [r[0] for r in conn.execute(f"SELECT id FROM photos WHERE user_id = ? AND {where}", (user_id, *args)).fetchall()]
    conn.execute(f"DELETE FROM photos WHERE user_id = ? AND {where}", (user_id, *args))
    conn.commit()
    conn.close()
    _remove_files(user_id, ids)
    return len(ids)


def delete_all(user_id: int) -> int:
    n = delete_where(user_id, "1 = 1", ())
    folder, _f, _t = _paths(user_id, "0" * 32)
    try:
        os.rmdir(folder)
    except OSError:
        pass
    return n


def cleanup_orphans() -> dict:
    """Раз в сутки: файлы без записи в базе и записи без файла или без плана."""
    removed_files = removed_rows = 0
    if not enabled():
        return {"files": 0, "rows": 0}
    conn = storage.connect()
    known = {(str(r[0]), r[1]) for r in conn.execute("SELECT user_id, id FROM photos").fetchall()}
    orphan_rows = [r[0] for r in conn.execute(
        "SELECT p.id FROM photos p LEFT JOIN plans pl ON pl.id = p.plan_id WHERE p.plan_id IS NOT NULL AND pl.id IS NULL").fetchall()]
    for pid in orphan_rows:
        conn.execute("DELETE FROM photos WHERE id = ?", (pid,))
    removed_rows += len(orphan_rows)
    conn.commit()
    conn.close()
    known -= {k for k in known if k[1] in orphan_rows}
    for user_dir in os.listdir(PHOTOS_DIR):
        folder = os.path.join(PHOTOS_DIR, user_dir)
        if not os.path.isdir(folder) or not user_dir.isdigit():
            continue
        for name in os.listdir(folder):
            pid = name.split(".")[0].replace("_t", "")
            if (user_dir, pid) not in known:
                try:
                    os.remove(os.path.join(folder, name))
                    removed_files += 1
                except OSError:
                    pass
    return {"files": removed_files, "rows": removed_rows}

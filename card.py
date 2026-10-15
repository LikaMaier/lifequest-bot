"""Карточка прогресса на сервере (Pillow) — для утреннего сообщения бота.

Та же карточка, что «Поделиться достижением» в мини-аппе: имя, «твой путь
к победе», уровень и три плитки, выбранный маскот с надетым аксессуаром.
Маскоты и аксессуары — готовые PNG из card_assets (отрисованы из mascot.js
в общей сетке, поэтому аксессуар просто накладывается сверху)."""

import io
import os

from PIL import Image, ImageDraw, ImageFont

import game
import storage

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_assets")
W, H = 1080, 1350
CREAM, WAVE, INK, SOFT, BRAND = "#FDF7DE", "#F8EDAD", "#2C2A22", "#6E6850", "#B23C6C"
PHRASE = "твой путь к победе"


def _font(name: str, size: int, weight: int):
    f = ImageFont.truetype(os.path.join(ASSETS, f"{name}.ttf"), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:  # шрифт без осей — оставляем как есть
        pass
    return f


def _fit(draw, text: str, name: str, size: int, weight: int, max_width: int):
    while size > 20:
        f = _font(name, size, weight)
        if draw.textlength(text, font=f) <= max_width:
            return f
        size -= 4
    return _font(name, size, weight)


def _bezier(p0, p1, p2, p3, steps=40):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
        pts.append((x, y))
    return pts


def _tile(draw, box, fill, shadow, radius):
    x, y, w, h = box
    draw.rounded_rectangle((x, y + 14, x + w, y + h + 14), radius, fill=shadow)
    draw.rounded_rectangle((x, y, x + w, y + h), radius, fill=fill)


def _mascot(kind: str, acc):
    path = os.path.join(ASSETS, "mascots", f"{kind}.png")
    if not os.path.exists(path):
        path = os.path.join(ASSETS, "mascots", "cat-purple.png")
    img = Image.open(path).convert("RGBA")
    if acc:
        ap = os.path.join(ASSETS, "acc", f"{acc}.png")
        if os.path.exists(ap):
            img.alpha_composite(Image.open(ap).convert("RGBA"))
    return img


def render(user_id: int, bot_username: str = None) -> bytes:
    user = storage.get_user(user_id)
    lv = game.level_info(user.get("xp") or 0)
    today = game.local_today(user)
    streak = game.user_streak(user, today)
    conn = storage.connect()
    badges = conn.execute("SELECT COUNT(*) FROM achievements_unlocked WHERE user_id = ?", (user_id,)).fetchone()[0]
    conn.close()
    name = user.get("first_name") or user.get("username") or "Я"
    kind = game.LEGACY_MASCOTS.get(user.get("mascot"), user.get("mascot")) or "cat-purple"

    img = Image.new("RGBA", (W, H), CREAM)
    d = ImageDraw.Draw(img)
    # «волны» сверху и снизу
    d.polygon([(0, 0)] + _bezier((0, 220), (300, 120), (650, 340), (1080, 180)) + [(1080, 0)], fill=WAVE)
    d.polygon(_bezier((0, 1180), (360, 1080), (700, 1290), (1080, 1150)) + [(1080, 1350), (0, 1350)], fill=WAVE)

    d.text((90, 120), "LIFEQUEST", font=_font("Nunito", 38, 800), fill=BRAND, anchor="ls")
    pet = _mascot(kind, game.visible_accessory(user)).resize((468, 468), Image.LANCZOS)
    img.alpha_composite(pet, (588, 56))

    d.text((90, 280), name, font=_fit(d, name, "Unbounded", 92, 800, 520), fill=INK, anchor="ls")
    d.text((90, 350), PHRASE, font=_font("Nunito", 42, 700), fill=SOFT, anchor="ls")

    # уровень
    _tile(d, (90, 500, 900, 230), "#B494F8", "#6B4B9E", 56)
    d.text((140, 580), f"УРОВЕНЬ {lv['level']}", font=_font("Nunito", 36, 800), fill="#6B4B9E", anchor="ls")
    d.text((140, 665), lv["name"], font=_fit(d, lv["name"], "Unbounded", 68, 800, 800), fill=INK, anchor="ls")
    d.rounded_rectangle((140, 690, 940, 708), 9, fill=(255, 255, 255, 140))
    d.rounded_rectangle((140, 690, 140 + max(18, int(800 * lv["progress"])), 708), 9, fill="#6B4B9E")

    tiles = [
        ("#ED7C30", "#A2531D", str(streak["current"]), "серия, дней"),
        ("#DBFA40", "#7C9414", str(lv["xp"]), "XP всего"),
        ("#F3619C", "#B23C6C", str(badges), "ачивок"),
    ]
    for i, (fill, deep, value, label) in enumerate(tiles):
        x = 90 + i * 310
        _tile(d, (x, 800, 280, 250), fill, deep, 48)
        d.text((x + 36, 940), value, font=_fit(d, value, "Unbounded", 92, 800, 220), fill=INK, anchor="ls")
        d.text((x + 36, 1000), label, font=_font("Nunito", 32, 800), fill=INK, anchor="ls")

    d.text((90, 1250), f"@{bot_username}" if bot_username else "LifeQuest в Telegram",
           font=_font("Nunito", 40, 800), fill=INK, anchor="ls")

    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=90)
    return out.getvalue()

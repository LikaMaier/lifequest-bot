"""Исходящие для владелицы: готовые ролики из релизов GitHub → в личку в Telegram.

Claude выкладывает видео как релиз репозитория с тегом `outbox-…`: файлы .mp4 —
вложения, текст релиза — подпись для Reels. Бот раз в пару минут смотрит
свежие релизы и присылает владелице (ADMIN_ID) каждое видео, а следом —
подпись отдельным сообщением, чтобы её было удобно скопировать.
Каждый релиз отправляется один раз (отметка в таблице meta)."""

import os
from datetime import datetime, timedelta, timezone

import storage

PREFIX = "outbox-"
MAX_AGE_DAYS = 7
MAX_VIDEO_BYTES = 49 * 1024 * 1024  # лимит Telegram для ботов — 50 МБ
REPO = os.getenv("OUTBOX_REPO", "LikaMaier/lifequest-bot")


def _key(tag: str) -> str:
    return f"outbox:{tag}"


def _sent(tag: str) -> bool:
    conn = storage.connect()
    row = conn.execute("SELECT 1 FROM meta WHERE key = ?", (_key(tag),)).fetchone()
    conn.close()
    return bool(row)


def mark_sent(tag: str):
    conn = storage.connect()
    conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", (_key(tag), storage.utc_now_str()))
    conn.commit()
    conn.close()


def pending(releases: list, now: datetime = None) -> list:
    """Свежие неотправленные релизы outbox-…, старые сначала."""
    now = now or datetime.now(timezone.utc)
    out = []
    for r in releases or []:
        tag = r.get("tag_name") or ""
        if not tag.startswith(PREFIX) or r.get("draft"):
            continue
        try:
            created = datetime.fromisoformat((r.get("published_at") or r.get("created_at") or "").replace("Z", "+00:00"))
        except ValueError:
            continue
        if now - created > timedelta(days=MAX_AGE_DAYS) or _sent(tag):
            continue
        videos = [a for a in r.get("assets") or [] if (a.get("name") or "").lower().endswith(".mp4")
                  and (a.get("size") or 0) <= MAX_VIDEO_BYTES]
        out.append({"tag": tag, "title": r.get("name") or tag, "body": (r.get("body") or "").strip(),
                    "videos": [(a["name"], a["browser_download_url"]) for a in videos], "created": created})
    return sorted(out, key=lambda x: x["created"])


def video_caption(item: dict, name: str, i: int, n: int) -> str:
    label = item["title"]
    if n > 1:
        kind = "с музыкой" if "music" in name.lower() else ("только звуки" if "sfx" in name.lower() else name)
        label += f" · {kind}"
    return ("🎬 " + label)[:1000]


async def check(bot, admin_id: int):
    """Проверить релизы и отправить новые ролики владелице."""
    if not admin_id:
        return
    import aiohttp
    from aiogram.types import BufferedInputFile
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "lifequest-bot"}
    if os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.getenv("GITHUB_TOKEN")
    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(headers=headers, timeout=timeout) as s:
        async with s.get(f"https://api.github.com/repos/{REPO}/releases?per_page=15") as resp:
            if resp.status != 200:
                return
            releases = await resp.json()
        for item in pending(releases):
            n = len(item["videos"])
            for i, (name, url) in enumerate(item["videos"]):
                async with s.get(url) as v:
                    if v.status != 200:
                        raise RuntimeError(f"outbox: {name} → HTTP {v.status}")
                    data = await v.read()
                await bot.send_video(admin_id, BufferedInputFile(data, filename=name),
                                     caption=video_caption(item, name, i, n),
                                     width=1080, height=1920, supports_streaming=True)
            if item["body"]:
                await bot.send_message(admin_id, "📝 Подпись для Reels — нажми и скопируй:")
                for k in range(0, len(item["body"]), 4000):
                    await bot.send_message(admin_id, item["body"][k:k + 4000])
            mark_sent(item["tag"])

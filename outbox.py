"""Исходящие для владелицы: готовые ролики от Claude → в личку в Telegram.

Claude пушит в ветку `outbox` репозитория папку `outbox/<имя>/` с видео (.mp4)
и подписью для Reels (`caption.txt`, по желанию `title.txt`). Ветка не
деплоится. Бот раз в пару минут смотрит список папок через GitHub API и
присылает владелице (ADMIN_ID) каждое видео, а следом — подпись отдельным
сообщением, чтобы её было удобно скопировать. Каждая папка отправляется один
раз (отметка в таблице meta)."""

import os

import storage

REPO = os.getenv("OUTBOX_REPO", "LikaMaier/lifequest-bot")
BRANCH = os.getenv("OUTBOX_BRANCH", "outbox")
MAX_VIDEO_BYTES = 49 * 1024 * 1024  # лимит Telegram для ботов — 50 МБ
API = "https://api.github.com"


def _key(name: str) -> str:
    return f"outbox:{name}"


def is_sent(name: str) -> bool:
    conn = storage.connect()
    row = conn.execute("SELECT 1 FROM meta WHERE key = ?", (_key(name),)).fetchone()
    conn.close()
    return bool(row)


def mark_sent(name: str):
    conn = storage.connect()
    conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", (_key(name), storage.utc_now_str()))
    conn.commit()
    conn.close()


def new_folders(listing: list) -> list:
    """Папки из outbox/, которые ещё не отправляли (по алфавиту = по дате в имени)."""
    names = [e["name"] for e in listing or [] if e.get("type") == "dir" and not is_sent(e["name"])]
    return sorted(names)


def parse_folder(files: list) -> dict:
    """Из содержимого папки: видео (имя, ссылка) и ссылки на подпись/заголовок."""
    vids, caption, title = [], None, None
    for f in files or []:
        name = (f.get("name") or "").lower()
        if f.get("type") != "file":
            continue
        if name.endswith(".mp4") and (f.get("size") or 0) <= MAX_VIDEO_BYTES:
            vids.append((f["name"], f["download_url"]))
        elif name == "caption.txt":
            caption = f["download_url"]
        elif name == "title.txt":
            title = f["download_url"]
    return {"videos": sorted(vids), "caption": caption, "title": title}


def video_caption(title: str, name: str, n: int) -> str:
    label = title
    if n > 1:
        low = name.lower()
        label += " · " + ("с музыкой" if "music" in low else "только звуки" if "sfx" in low else name)
    return ("🎬 " + label)[:1000]


async def check(bot, admin_id: int):
    """Проверить ветку outbox и отправить новые ролики владелице."""
    if not admin_id:
        return
    import aiohttp
    from aiogram.types import BufferedInputFile
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "lifequest-bot"}
    if os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.getenv("GITHUB_TOKEN")
    async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=180)) as s:
        async with s.get(f"{API}/repos/{REPO}/contents/outbox?ref={BRANCH}") as r:
            if r.status != 200:  # ветки или папки ещё нет — молча ждём
                return
            listing = await r.json()
        for folder in new_folders(listing):
            async with s.get(f"{API}/repos/{REPO}/contents/outbox/{folder}?ref={BRANCH}") as r:
                if r.status != 200:
                    continue
                item = parse_folder(await r.json())

            async def text(url):
                if not url:
                    return ""
                async with s.get(url) as t:
                    return (await t.text()).strip() if t.status == 200 else ""

            title = await text(item["title"]) or folder
            caption = await text(item["caption"])
            n = len(item["videos"])
            for name, url in item["videos"]:
                async with s.get(url) as v:
                    if v.status != 200:
                        raise RuntimeError(f"outbox: {folder}/{name} → HTTP {v.status}")
                    data = await v.read()
                await bot.send_video(admin_id, BufferedInputFile(data, filename=name),
                                     caption=video_caption(title, name, n),
                                     width=1080, height=1920, supports_streaming=True)
            if caption:
                await bot.send_message(admin_id, "📝 Подпись для Reels — нажми и скопируй:")
                for k in range(0, len(caption), 4000):
                    await bot.send_message(admin_id, caption[k:k + 4000])
            mark_sent(folder)

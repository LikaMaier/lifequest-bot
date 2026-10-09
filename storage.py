# ============================================================
# LIFEQUEST — хранилище (SQLite)
# Схема, миграции и доступ к данным. Используется и ботом, и API мини-аппа.
# Путь к базе — переменная окружения DB_PATH (на Railway укажите путь внутри
# подключённого Volume, например /data/lifequest.db, иначе база стирается
# при каждом деплое).
# ============================================================

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta

from quests_database import CATALOG

DB_PATH = os.getenv("DB_PATH", "lifequest.db")


def connect(rows: bool = False) -> sqlite3.Connection:
    """Новое соединение. rows=True — строки как sqlite3.Row (доступ по имени)."""
    folder = os.path.dirname(DB_PATH)
    if folder:
        os.makedirs(folder, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA busy_timeout = 5000")
    if rows:
        conn.row_factory = sqlite3.Row
    return conn


def utc_now_str() -> str:
    """Тот же формат, что у CURRENT_TIMESTAMP в SQLite (UTC)."""
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _ensure_column(c, table: str, column: str, coltype: str):
    c.execute(f"PRAGMA table_info({table})")
    cols = [row[1] for row in c.fetchall()]
    if column not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


def init_db():
    conn = connect()
    c = conn.cursor()
    c.execute("PRAGMA journal_mode = WAL")
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            profile TEXT,
            bingo_card TEXT,
            current_week INTEGER DEFAULT 1,
            streak_days INTEGER DEFAULT 0
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS survey_answers (
            user_id INTEGER,
            question_id TEXT,
            answer_value INTEGER,
            answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS completed_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            task_cell TEXT,
            task_text TEXT,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS active_quests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            task_key TEXT,
            task_text TEXT,
            taken_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS weekly_boards (
            user_id INTEGER PRIMARY KEY,
            week_key TEXT,
            board_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # --- мини-апп v2 ---
    # Полная история заданий: принято / выполнено / пропущено. Бот продолжает
    # работать с active_quests и completed_tasks, а game.py пишет и туда, и сюда.
    c.execute("""
        CREATE TABLE IF NOT EXISTS quest_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            quest_key TEXT,
            mode TEXT,
            sphere TEXT,
            title TEXT,
            tier TEXT,
            status TEXT NOT NULL,
            daily INTEGER DEFAULT 0,
            active_quest_id INTEGER,
            accepted_at TEXT,
            completed_at TEXT,
            skipped_at TEXT,
            local_date TEXT,
            local_hour INTEGER,
            xp INTEGER DEFAULT 0
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_qh_user_status ON quest_history(user_id, status)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_qh_active ON quest_history(active_quest_id)")
    # Что выпадало пользователю — чтобы не повторяться и ограничивать rerolls.
    c.execute("""
        CREATE TABLE IF NOT EXISTS quest_offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            quest_key TEXT NOT NULL,
            mode TEXT,
            local_date TEXT,
            offered_at TEXT
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_offers_user ON quest_offers(user_id, offered_at)")
    c.execute("""
        CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER NOT NULL,
            quest_key TEXT NOT NULL,
            added_at TEXT,
            PRIMARY KEY (user_id, quest_key)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS achievements_unlocked (
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            unlocked_at TEXT,
            PRIMARY KEY (user_id, code)
        )
    """)
    # Награды карты недели (клетка/линия/полная карта) — по разу за неделю,
    # чтобы снятие и повторная отметка клетки не давали XP повторно.
    c.execute("""
        CREATE TABLE IF NOT EXISTS board_awards (
            user_id INTEGER NOT NULL,
            week_key TEXT NOT NULL,
            kind TEXT NOT NULL,
            xp INTEGER DEFAULT 0,
            created_at TEXT,
            PRIMARY KEY (user_id, week_key, kind)
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS xp_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            reason TEXT,
            local_date TEXT,
            created_at TEXT
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_log(user_id, local_date)")
    c.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    # Трекер привычек: свои привычки пользователя и отметки по дням.
    c.execute("""
        CREATE TABLE IF NOT EXISTS habits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            emoji TEXT,
            color TEXT,
            target INTEGER DEFAULT 1,
            unit TEXT,
            archived INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id, archived)")
    c.execute("""
        CREATE TABLE IF NOT EXISTS habit_logs (
            habit_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            local_date TEXT NOT NULL,
            count INTEGER DEFAULT 0,
            done INTEGER DEFAULT 0,
            updated_at TEXT,
            PRIMARY KEY (habit_id, local_date)
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_habit_logs_user ON habit_logs(user_id, local_date)")

    # Migrations for bots created before these features existed.
    _ensure_column(c, "users", "last_active_date", "TEXT")
    _ensure_column(c, "users", "reminder_hour", "INTEGER DEFAULT 9")
    _ensure_column(c, "users", "scores", "TEXT")
    _ensure_column(c, "users", "top_pattern", "TEXT")
    _ensure_column(c, "users", "interests", "TEXT")
    _ensure_column(c, "users", "topics", "TEXT")
    _ensure_column(c, "users", "rest_style", "TEXT")
    _ensure_column(c, "users", "card_regens", "INTEGER DEFAULT 0")
    _ensure_column(c, "users", "evening_reminder_hour", "INTEGER DEFAULT 20")
    _ensure_column(c, "completed_tasks", "week", "INTEGER DEFAULT 1")
    # мини-апп v2: профиль, настройки, XP и серия
    _ensure_column(c, "users", "first_name", "TEXT")
    _ensure_column(c, "users", "xp", "INTEGER DEFAULT 0")
    _ensure_column(c, "users", "daily_goal", "INTEGER DEFAULT 1")
    _ensure_column(c, "users", "tz", "TEXT")
    _ensure_column(c, "users", "mascot", "TEXT")
    _ensure_column(c, "users", "accent", "TEXT")
    _ensure_column(c, "users", "is_premium", "INTEGER DEFAULT 0")
    _ensure_column(c, "users", "streak_current", "INTEGER DEFAULT 0")
    _ensure_column(c, "users", "streak_best", "INTEGER DEFAULT 0")
    _ensure_column(c, "users", "streak_last_date", "TEXT")
    _ensure_column(c, "users", "freeze_week", "TEXT")
    _ensure_column(c, "users", "last_seen_at", "TEXT")
    _ensure_column(c, "active_quests", "mode", "TEXT")
    _ensure_column(c, "active_quests", "sphere", "TEXT")
    _ensure_column(c, "active_quests", "tier", "TEXT")
    _ensure_column(c, "active_quests", "daily", "INTEGER DEFAULT 0")

    conn.commit()
    _backfill_history(conn)
    conn.close()


_TAG_RE = re.compile(r"<[^>]+>")


def _title_for(key: str, text: str) -> str:
    q = CATALOG.get(key)
    if q:
        return q["title"]
    first = (text or "").strip().split("\n")[0]
    return _TAG_RE.sub("", first).strip()[:120] or "Задание"


def _backfill_history(conn):
    """Разово переносит в quest_history то, что было выполнено и принято до
    появления мини-аппа v2, чтобы статистика и ачивки учли старый прогресс."""
    c = conn.cursor()
    c.execute("SELECT value FROM meta WHERE key = 'history_backfilled'")
    if c.fetchone():
        return
    c.execute("SELECT user_id, task_cell, task_text, completed_at FROM completed_tasks")
    for user_id, key, text, completed_at in c.fetchall():
        q = CATALOG.get(key) or {}
        done_at = completed_at or utc_now_str()
        c.execute("""
            INSERT INTO quest_history (user_id, quest_key, mode, sphere, title, status,
                                       accepted_at, completed_at, local_date, local_hour)
            VALUES (?, ?, ?, ?, ?, 'done', ?, ?, ?, ?)
        """, (user_id, key, q.get("mode"), q.get("sphere"), _title_for(key, text),
              done_at, done_at, done_at[:10], int(done_at[11:13] or 12)))
    c.execute("SELECT id, user_id, task_key, task_text, taken_at FROM active_quests")
    for qid, user_id, key, text, taken_at in c.fetchall():
        q = CATALOG.get(key) or {}
        c.execute("""
            INSERT INTO quest_history (user_id, quest_key, mode, sphere, title, status,
                                       active_quest_id, accepted_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        """, (user_id, key, q.get("mode"), q.get("sphere"), _title_for(key, text),
              qid, taken_at or utc_now_str()))
        c.execute("UPDATE active_quests SET mode = ?, sphere = ? WHERE id = ?",
                  (q.get("mode"), q.get("sphere"), qid))
    c.execute("INSERT INTO meta (key, value) VALUES ('history_backfilled', ?)", (utc_now_str(),))
    conn.commit()


# ==================== USERS ====================
def ensure_user(user_id: int, username: str = None, first_name: str = None):
    conn = connect()
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)", (user_id, username))
    if username:
        c.execute("UPDATE users SET username = ? WHERE user_id = ?", (username, user_id))
    if first_name:
        c.execute("UPDATE users SET first_name = ? WHERE user_id = ?", (first_name[:64], user_id))
    conn.commit()
    conn.close()


def get_user(user_id: int) -> dict:
    conn = connect(rows=True)
    row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else {}


def update_user(user_id: int, **fields):
    """Обновляет только переданные колонки (имена — из кода, не от клиента)."""
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    conn = connect()
    conn.execute(f"UPDATE users SET {cols} WHERE user_id = ?", (*fields.values(), user_id))
    conn.commit()
    conn.close()


def save_user_profile(user_id: int, profile: str, scores_json: str, bingo_json: str, top_pattern: str = None):
    """Upsert so a re-taken survey never wipes week/streak/username — only
    profile, scores, top_pattern and bingo_card are touched."""
    conn = connect()
    c = conn.cursor()
    c.execute("""
        INSERT INTO users (user_id, profile, scores, bingo_card, top_pattern)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            profile = excluded.profile,
            scores = excluded.scores,
            bingo_card = excluded.bingo_card,
            top_pattern = excluded.top_pattern
    """, (user_id, profile, scores_json, bingo_json, top_pattern))
    conn.commit()
    conn.close()


def get_user_profile(user_id: int):
    conn = connect()
    c = conn.cursor()
    c.execute("SELECT profile, bingo_card FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row if row else (None, None)


def get_user_week(user_id: int) -> int:
    conn = connect()
    c = conn.cursor()
    c.execute("SELECT current_week FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else 1


def touch_activity(user_id: int):
    """Updates the daily streak: +1 if last active yesterday, reset to 1 on a gap,
    unchanged if already counted today."""
    today = datetime.now().date()
    conn = connect()
    c = conn.cursor()
    c.execute("SELECT last_active_date, streak_days FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    if row:
        last_active, streak = row
        streak = streak or 0
        if last_active == str(today):
            pass
        elif last_active == str(today - timedelta(days=1)):
            c.execute("UPDATE users SET last_active_date = ?, streak_days = ? WHERE user_id = ?",
                      (str(today), streak + 1, user_id))
        else:
            c.execute("UPDATE users SET last_active_date = ?, streak_days = 1 WHERE user_id = ?",
                      (str(today), user_id))
        conn.commit()
    conn.close()


def get_streak(user_id: int) -> int:
    conn = connect()
    c = conn.cursor()
    c.execute("SELECT streak_days FROM users WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return row[0] if row and row[0] else 0


# ==================== COMPLETED / ACTIVE (как в боте) ====================
def save_completed_task(user_id: int, cell: str, text: str, week: int = None):
    if week is None:
        week = get_user_week(user_id)
    conn = connect()
    c = conn.cursor()
    c.execute("""
        INSERT INTO completed_tasks (user_id, task_cell, task_text, week)
        VALUES (?, ?, ?, ?)
    """, (user_id, cell, text, week))
    conn.commit()
    conn.close()


def get_recent_completed_texts(user_id: int, limit: int = 8) -> list:
    conn = connect()
    c = conn.cursor()
    c.execute("""
        SELECT task_text FROM completed_tasks
        WHERE user_id = ? AND task_text IS NOT NULL
        ORDER BY completed_at DESC LIMIT ?
    """, (user_id, limit))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows if r[0]]


def save_active_quest(user_id: int, task_key: str, task_text: str,
                      mode: str = None, sphere: str = None, tier: str = None, daily: bool = False) -> int:
    conn = connect()
    c = conn.cursor()
    c.execute(
        "INSERT INTO active_quests (user_id, task_key, task_text, mode, sphere, tier, daily) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, task_key, task_text, mode, sphere, tier, 1 if daily else 0)
    )
    conn.commit()
    quest_id = c.lastrowid
    conn.close()
    return quest_id


def get_active_quests(user_id: int) -> list:
    """Возвращает [(id, task_key, task_text, taken_at), ...], старые сверху."""
    conn = connect()
    c = conn.cursor()
    c.execute(
        "SELECT id, task_key, task_text, taken_at FROM active_quests WHERE user_id = ? ORDER BY taken_at",
        (user_id,)
    )
    rows = c.fetchall()
    conn.close()
    return rows


def get_active_quest(user_id: int, quest_id: int):
    conn = connect()
    c = conn.cursor()
    c.execute(
        "SELECT id, task_key, task_text FROM active_quests WHERE id = ? AND user_id = ?",
        (quest_id, user_id)
    )
    row = c.fetchone()
    conn.close()
    return row


def is_quest_already_active(user_id: int, task_key: str) -> bool:
    conn = connect()
    c = conn.cursor()
    c.execute(
        "SELECT COUNT(*) FROM active_quests WHERE user_id = ? AND task_key = ?",
        (user_id, task_key)
    )
    count = c.fetchone()[0]
    conn.close()
    return count > 0


def remove_active_quest(user_id: int, quest_id: int):
    conn = connect()
    c = conn.cursor()
    c.execute("DELETE FROM active_quests WHERE id = ? AND user_id = ?", (quest_id, user_id))
    conn.commit()
    conn.close()


def get_monthly_completed_count(user_id: int, year: int = None, month: int = None) -> int:
    """Сколько клеток человек закрыл за указанный месяц (по умолчанию — текущий).
    Заменяет собой стрик: не дневная серия, а «счёт месяца», который обнуляется
    сам собой 1 числа (просто фильтром по дате, без реального удаления истории)."""
    now = datetime.now()
    year = year or now.year
    month = month or now.month
    conn = connect()
    c = conn.cursor()
    c.execute(
        "SELECT COUNT(*) FROM completed_tasks WHERE user_id = ? AND strftime('%Y-%m', completed_at) = ?",
        (user_id, f"{year:04d}-{month:02d}")
    )
    count = c.fetchone()[0]
    conn.close()
    return count


def get_users_with_completions(year: int, month: int) -> list:
    """user_id всех, кто закрыл хотя бы одно задание за месяц — для итога месяца."""
    conn = connect()
    rows = conn.execute(
        "SELECT DISTINCT user_id FROM completed_tasks WHERE strftime('%Y-%m', completed_at) = ?",
        (f"{year:04d}-{month:02d}",)
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def get_completed_today(user_id: int) -> list:
    """Тексты заданий, отмеченных сегодня (по дате сервера) — для вечернего
    напоминания."""
    conn = connect()
    c = conn.cursor()
    c.execute("""
        SELECT task_text FROM completed_tasks
        WHERE user_id = ? AND date(completed_at) = date('now') AND task_text IS NOT NULL
        ORDER BY completed_at
    """, (user_id,))
    rows = c.fetchall()
    conn.close()
    return [r[0] for r in rows]


# ==================== WEEKLY BOARD ====================
BOARD_CELLS = 9
BOARD_CELL_MAX = 80
BOARD_REWARD_MAX = 80
BOARD_NOTES_MAX = 300


def week_key_for(day) -> str:
    """ISO-неделя вида '2026-W39': с началом новой недели карта пустая."""
    iso = day.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def get_current_week_key(today=None) -> str:
    return week_key_for(today or datetime.now().date())


def get_week_range_label(today=None) -> str:
    """Диапазон текущей недели для шапки мини-аппа, например «21–27 сен»."""
    months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
    today = today or datetime.now().date()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    if monday.month == sunday.month:
        return f"{monday.day}–{sunday.day} {months[monday.month - 1]}"
    return f"{monday.day} {months[monday.month - 1]} – {sunday.day} {months[sunday.month - 1]}"


def normalize_board(raw) -> dict:
    """Приводит карту к ожидаемой форме и обрезает длинные тексты."""
    raw = raw if isinstance(raw, dict) else {}
    cells = raw.get("cells") if isinstance(raw.get("cells"), list) else []
    done = raw.get("done") if isinstance(raw.get("done"), list) else []
    cells = [str(x or "")[:BOARD_CELL_MAX] for x in cells[:BOARD_CELLS]]
    cells += [""] * (BOARD_CELLS - len(cells))
    done = [bool(x) for x in done[:BOARD_CELLS]]
    done += [False] * (BOARD_CELLS - len(done))
    try:
        rating = max(0, min(10, int(raw.get("rating") or 0)))
    except (TypeError, ValueError):
        rating = 0
    return {
        "cells": cells,
        "done": done,
        "reward": str(raw.get("reward") or "")[:BOARD_REWARD_MAX],
        "rating": rating,
        "notes": str(raw.get("notes") or "")[:BOARD_NOTES_MAX],
    }


def get_weekly_board(user_id: int, today=None) -> dict:
    conn = connect()
    c = conn.cursor()
    c.execute("SELECT week_key, board_json FROM weekly_boards WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    if row and row[0] == get_current_week_key(today) and row[1]:
        try:
            return normalize_board(json.loads(row[1]))
        except (TypeError, json.JSONDecodeError):
            pass
    return normalize_board({})


def save_weekly_board(user_id: int, board: dict, today=None):
    conn = connect()
    c = conn.cursor()
    c.execute("""
        INSERT INTO weekly_boards (user_id, week_key, board_json, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            week_key = excluded.week_key,
            board_json = excluded.board_json,
            updated_at = CURRENT_TIMESTAMP
    """, (user_id, get_current_week_key(today), json.dumps(board, ensure_ascii=False)))
    conn.commit()
    conn.close()

"""Каталог готовых привычек для мини-аппа — единственный источник: habits_bank.py.

Здесь весь маппинг банка в формат привычек приложения (habits.py):
  key            → bank_key (по нему на карточке показываем tiny/why)
  label          → title
  freq           → schedule: daily → daily, weekdays → days '1111100', weekly → weekly ×1
  сфера          → sphere (ключ body/food/…), цвет сферы → color привычки
  tiny, why      → подсказка на карточке (механики «минимум засчитывается» нет)
  xp             → не используется: XP за привычки в приложении общий
Эмодзи в банке нет — подобраны здесь, по одному на привычку."""

from habits_bank import HABIT_SPHERES

EMOJI = {
    "morning_stretch": "🤸", "daily_walk": "🚶", "steps_goal": "👟", "workout_short": "💪",
    "posture_breaks": "🪑", "dance_one_song": "💃", "yoga_session": "🧘",
    "water_morning": "🥛", "water_goal": "💧", "veggies_each_meal": "🥦", "real_breakfast": "🍳",
    "no_snack_screen": "🍽️", "cook_at_home": "🥗", "plan_menu": "📝",
    "bed_on_time": "🛏️", "no_phone_before_bed": "📵", "evening_ritual": "🌙", "air_room": "🪟",
    "wake_same_time": "⏰", "midday_rest": "😌", "caffeine_cutoff": "☕",
    "read_pages": "📖", "language_practice": "🗣️", "learn_something_new": "💡", "podcast_lecture": "🎧",
    "online_course": "🎓", "notes_takeaway": "✍️", "brain_game": "♟️",
    "make_bed": "🛏️", "plan_day": "🗒️", "tidy_10_min": "🧹", "eat_the_frog": "🐸",
    "clear_desk": "🗂️", "inbox_zero": "📨", "weekly_review": "🏆",
    "draw_sketch": "✏️", "write_free": "📓", "instrument_practice": "🎸", "photo_of_beauty": "📷",
    "hobby_time": "🧩", "handmade_project": "🧶", "something_new_art": "🎨",
    "message_loved_one": "💌", "compliment": "🌷", "call_friend": "📞", "quality_time": "🫶",
    "say_thanks": "🙏", "meet_someone": "☕", "small_kindness": "🤝",
    "breathing": "🌬️", "meditation": "🧘", "gratitude_three": "🌟", "mood_journal": "📔",
    "digital_detox": "📴", "sun_light": "☀️", "self_care": "🛁",
}

SCHEDULE = {
    "daily": {"schedule": "daily"},
    "weekdays": {"schedule": "days", "days": "1111100"},
    "weekly": {"schedule": "weekly", "per_week": 1},
}
FREQ_TEXT = {"daily": "каждый день", "weekdays": "по будням", "weekly": "раз в неделю"}


def _color(css_var: str) -> str:
    """'--orange' → 'orange' (имя цвета в палитре приложения)."""
    return css_var.lstrip("-")


def spheres() -> list:
    """Сферы банка: [{key, name, emoji, color}] — в порядке банка."""
    return [{"key": k, "name": s["title"], "emoji": s["emoji"], "color": _color(s["color"])}
            for k, s in HABIT_SPHERES.items()]


SPHERE_KEYS = tuple(HABIT_SPHERES)


def _item(sphere_key: str, s: dict, hb: dict) -> dict:
    return {"key": hb["key"], "title": hb["label"], "emoji": EMOJI.get(hb["key"], s["emoji"]),
            "sphere": sphere_key, "color": _color(s["color"]), "tiny": hb["tiny"], "why": hb["why"],
            "freq": hb["freq"], "freq_text": FREQ_TEXT[hb["freq"]], **SCHEDULE[hb["freq"]]}


def catalog() -> list:
    """Каталог для фронта: сферы с привычками в формате приложения."""
    return [{**sp, "habits": [_item(sp["key"], HABIT_SPHERES[sp["key"]], hb) for hb in HABIT_SPHERES[sp["key"]]["habits"]]}
            for sp in spheres()]


_BY_KEY = {hb["key"]: _item(k, s, hb) for k, s in HABIT_SPHERES.items() for hb in s["habits"]}


def by_key(key) -> dict:
    return _BY_KEY.get(key) if key else None

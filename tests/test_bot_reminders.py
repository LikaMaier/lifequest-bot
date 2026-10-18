import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

from tests.helpers import TempDBTestCase
import storage

# Импорт бота создаёт Bot и вызывает init_db — направляем всё во временную базу.
os.environ.setdefault("BOT_TOKEN", "123456789:TEST-TOKEN")
os.environ["MINIAPP_URL"] = "https://example.app/"
_boot_dir = tempfile.mkdtemp()
_old = storage.DB_PATH
storage.DB_PATH = os.path.join(_boot_dir, "boot.db")
import lifequest_bot  # noqa: E402
storage.DB_PATH = _old

import game  # noqa: E402
import plans  # noqa: E402


class BotRemindersTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(5)
        storage.update_user(5, tz="Europe/Moscow")
        self.sent = []

        async def fake_send(chat_id, text, **kw):
            self.sent.append((chat_id, text, kw.get("reply_markup")))
        self.patch = mock.patch.object(lifequest_bot.bot, "send_message", side_effect=fake_send)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        TempDBTestCase.tearDown(self)

    async def test_plan_reminder_once_and_escaped(self):
        now_local = game.local_now(storage.get_user(5))
        t = (now_local + timedelta(minutes=2)).strftime("%H:%M")
        day = now_local.date().isoformat()
        if t < now_local.strftime("%H:%M"):  # переход через полночь — пропускаем редкий случай
            self.skipTest("около полуночи")
        plans.create_plan(5, {"title": "<b>Звонок</b> & чай", "date": day, "time": t, "remind": "at_time"})
        later = datetime.utcnow() + timedelta(minutes=3)
        due = plans.due_reminders(later)
        self.assertEqual(len(due), 1)
        with mock.patch.object(plans, "due_reminders", return_value=due):
            await lifequest_bot.send_plan_reminders()
        self.assertEqual(len(self.sent), 1)
        self.assertIn("&lt;b&gt;Звонок&lt;/b&gt; &amp; чай", self.sent[0][1])
        self.assertEqual(plans.due_reminders(later), [])  # помечено отправленным

    async def test_morning_summary_respects_switch(self):
        today = game.local_today(storage.get_user(5)).isoformat()
        plans.create_plan(5, {"title": "Йога", "date": today, "time": "08:00"})
        await lifequest_bot.send_morning_plans(5)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("Сегодня у тебя в планах", self.sent[0][1])
        self.assertIn("08:00 — 📝 Йога", self.sent[0][1])
        storage.update_user(5, morning_plans=0)
        await lifequest_bot.send_morning_plans(5)
        self.assertEqual(len(self.sent), 1)


class MorningCardTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    """Утро: картинка с маскотом + шутка и статистика, без кнопок с заданиями."""

    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(7, "u", "Лика")
        storage.update_user(7, tz="Europe/Moscow", mascot="panda")
        self.sent, self.photos = [], []

        async def fake_send(chat_id, text, **kw):
            self.sent.append((chat_id, text, kw.get("reply_markup")))

        async def fake_photo(chat_id, photo, **kw):
            self.photos.append((chat_id, photo, kw.get("caption"), kw.get("reply_markup")))
        self.p1 = mock.patch.object(lifequest_bot.bot, "send_message", side_effect=fake_send)
        self.p2 = mock.patch.object(lifequest_bot.bot, "send_photo", side_effect=fake_photo)
        self.p3 = mock.patch.object(lifequest_bot.bot, "get_me", new=mock.AsyncMock(return_value=mock.MagicMock(username="Bingo_Life_Quest_bot")))
        for p in (self.p1, self.p2, self.p3):
            p.start()

    def tearDown(self):
        for p in (self.p1, self.p2, self.p3):
            p.stop()
        TempDBTestCase.tearDown(self)

    async def test_morning_is_a_card_with_stats_and_only_app_button(self):
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[7]):
            await lifequest_bot.send_daily_reminders()
        # первое утро после обновления — убираем старую клавиатуру
        self.assertEqual(len(self.sent), 1)
        self.assertIn("Бот обновился", self.sent[0][1])
        self.assertEqual(len(self.photos), 1)
        _, photo, caption, kb = self.photos[0]
        self.assertTrue(photo.data.startswith(b"\xff\xd8"))  # JPEG
        self.assertIn("Твоя статистика", caption)
        self.assertIn("Серия", caption)
        datas = [b.callback_data for row in kb.inline_keyboard for b in row]
        self.assertEqual([d for d in datas if d], [])  # только кнопка приложения
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[7]):
            await lifequest_bot.send_daily_reminders()
        self.assertEqual(len(self.sent), 1)  # клавиатуру убираем один раз

    async def test_old_buttons_and_commands_point_to_app(self):
        cb = mock.MagicMock()
        cb.data = "menu_solo"
        cb.answer = mock.AsyncMock()
        await lifequest_bot.old_buttons(cb)
        self.assertTrue(cb.answer.await_args.kwargs.get("show_alert"))
        msg = mock.MagicMock()
        msg.text = "/solo"
        msg.from_user.id, msg.from_user.username, msg.from_user.first_name = 7, "u", "Лика"
        msg.answer = mock.AsyncMock()
        await lifequest_bot.cmd_app_only(msg)
        kb = msg.answer.await_args.kwargs["reply_markup"]
        self.assertIsNotNone(kb.inline_keyboard[0][0].web_app)


class FunnyNudgesTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(9)
        storage.update_user(9, tz="Europe/Moscow", mascot="panda")
        self.sent = []

        async def fake_send(chat_id, text, **kw):
            self.sent.append((chat_id, text, kw.get("reply_markup")))
        self.patch = mock.patch.object(lifequest_bot.bot, "send_message", side_effect=fake_send)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        TempDBTestCase.tearDown(self)

    @staticmethod
    def last_button_is_app(kb):
        last = kb.inline_keyboard[-1][0]
        return last.web_app is not None and "Открыть LifeQuest" in last.text

    def test_all_lines_format(self):
        import nudges
        from datetime import date
        for kind, pool in nudges.LINES.items():
            for i in range(len(pool)):
                text = nudges.pick(kind, i, date(2026, 1, 1) - __import__("datetime").timedelta(days=0),
                                   m="Панда", days=4, hours=3, streak=5, xp=20, plan="<Йога>")
                self.assertNotIn("{", text)
                self.assertNotIn("<Йога>", text)  # план экранирован

    def test_no_repeat_on_consecutive_days(self):
        import nudges
        from datetime import date, timedelta
        d = date(2026, 3, 1)
        for kind in nudges.LINES:
            a = nudges.pick(kind, 9, d, m="Панда", days=4, hours=3, streak=5, xp=20, plan="x")
            b = nudges.pick(kind, 9, d + timedelta(days=1), m="Панда", days=4, hours=3, streak=5, xp=20, plan="x")
            self.assertNotEqual(a, b, kind)

    async def test_every_reminder_has_app_button(self):
        today = game.local_today(storage.get_user(9))
        plans.create_plan(9, {"title": "Йога", "date": today.isoformat(), "time": "08:00"})
        storage.update_user(9, kb_cleared=1)

        async def fake_photo(chat_id, photo, **kw):
            self.sent.append((chat_id, kw.get("caption"), kw.get("reply_markup")))
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[9]), \
                mock.patch.object(lifequest_bot.bot, "send_photo", side_effect=fake_photo), \
                mock.patch.object(lifequest_bot.bot, "get_me", new=mock.AsyncMock(return_value=mock.MagicMock(username="b"))):
            await lifequest_bot.send_daily_reminders()
            await lifequest_bot.send_evening_reminders()
        self.assertEqual(len(self.sent), 3)  # утро (картинка), планы, вечер
        for _, _, kb in self.sent:
            self.assertTrue(self.last_button_is_app(kb))

    async def test_evening_streak_drama_and_absent_morning(self):
        import nudges
        today = game.local_today(storage.get_user(9))
        yesterday = (today - timedelta(days=1)).isoformat()
        storage.update_user(9, streak_current=6, streak_last_date=yesterday)
        text, _ = lifequest_bot.build_evening_message(9)
        self.assertTrue(any(line.split("{")[0][:12] in text for line in nudges.LINES["evening_streak"]))
        storage.update_user(9, streak_last_date=(today - timedelta(days=5)).isoformat(), last_seen_at=None)
        text, _ = lifequest_bot.build_morning_message(9)
        # шутка выбирается по дате; сравниваем по самому длинному куску текста без подстановок
        import re
        chunk = lambda line: max(re.split(r"\{\w+\}", line), key=len).strip()[:20]
        self.assertTrue(any(chunk(line) in text for line in nudges.LINES["absent"]))


    async def test_evening_halloween_gift_line(self):
        from unittest import mock
        with mock.patch.object(game, "gift_today", lambda u: "halloween"):
            text, _ = lifequest_bot.build_evening_message(9)
        self.assertIn("Подарок к Хэллоуину", text)
        with mock.patch.object(game, "gift_today", lambda u: None):
            text, _ = lifequest_bot.build_evening_message(9)
        self.assertNotIn("Подарок к Хэллоуину", text)

class BlockedUsersTest(TempDBTestCase):
    def test_blocked_users_skipped_in_reminders(self):
        storage.ensure_user(11)
        hour = game.local_now(storage.get_user(11)).hour
        storage.update_user(11, reminder_hour=hour)
        self.assertIn(11, lifequest_bot.users_at_local_hour("reminder_hour", 9))
        storage.set_blocked(11)
        self.assertNotIn(11, lifequest_bot.users_at_local_hour("reminder_hour", 9))


class WeeklySummaryTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(21)
        storage.update_user(21, tz="Europe/Moscow")
        self.sent = []

        async def fake_send(chat_id, text, **kw):
            self.sent.append((chat_id, text, kw.get("reply_markup")))
        self.patch = mock.patch.object(lifequest_bot.bot, "send_message", side_effect=fake_send)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        TempDBTestCase.tearDown(self)

    def add_done(self, day, n=1):
        conn = storage.connect()
        for _ in range(n):
            conn.execute("""INSERT INTO quest_history (user_id, quest_key, mode, title, status, local_date)
                            VALUES (21, 'x', 'solo', 'x', 'done', ?)""", (day.isoformat(),))
            conn.execute("INSERT INTO xp_log (user_id, amount, reason, local_date, created_at) VALUES (21, 20, 'q', ?, '')",
                         (day.isoformat(),))
        conn.commit()
        conn.close()

    def test_summary_numbers(self):
        today = game.local_today(storage.get_user(21))
        self.add_done(today, 2)
        self.add_done(today - timedelta(days=2), 1)
        self.add_done(today - timedelta(days=9), 1)  # прошлая неделя
        text, kb = lifequest_bot.build_weekly_message(21)
        self.assertIn("Итоги недели", text)
        self.assertIn("Квестов: <b>3</b> (+2 к прошлой)", text)
        self.assertIn("60 XP", text)
        self.assertIn("Активных дней: 2 из 7", text)
        self.assertIn(game.WEEKDAYS_RU[today.weekday()], text)
        self.assertTrue(kb.inline_keyboard[-1][0].web_app)

    def test_quiet_users_not_disturbed(self):
        self.assertEqual(lifequest_bot.build_weekly_message(21), (None, None))

    async def test_sent_on_sunday_only(self):
        today = game.local_today(storage.get_user(21))
        sunday = today + timedelta(days=6 - today.weekday())  # ближайшее воскресенье, не зависит от даты запуска
        self.add_done(sunday)
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[21]), \
             mock.patch.object(game, "local_today", return_value=sunday):
            await lifequest_bot.send_evening_reminders()
        self.assertTrue(any("Итоги недели" in t for _, t, _ in self.sent))
        self.sent.clear()
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[21]), \
             mock.patch.object(game, "local_today", return_value=sunday - timedelta(days=1)):
            await lifequest_bot.send_evening_reminders()
        self.assertFalse(any("Итоги недели" in t for _, t, _ in self.sent))


class EditMessageTest(unittest.IsolatedAsyncioTestCase):
    async def test_not_modified_is_ignored_other_errors_raise(self):
        from aiogram.exceptions import TelegramBadRequest
        from aiogram.methods import EditMessageText
        method = EditMessageText(text="x")
        msg = mock.MagicMock()
        msg.edit_text = mock.AsyncMock(side_effect=TelegramBadRequest(method=method, message="Bad Request: message is not modified: same"))
        self.assertIsNone(await lifequest_bot.safe_edit(msg, "x"))
        msg.edit_text = mock.AsyncMock(side_effect=TelegramBadRequest(method=method, message="Bad Request: message to edit not found"))
        with self.assertRaises(TelegramBadRequest):
            await lifequest_bot.safe_edit(msg, "x")


class BotHandlersTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    """Обработчики бота на фейковых callback/message (без Telegram)."""

    def _callback(self, data, user_id=77):
        cb = mock.MagicMock()
        cb.data = data
        cb.from_user.id, cb.from_user.username, cb.from_user.first_name = user_id, "u", "Тест"
        cb.answer = mock.AsyncMock()
        return cb

    async def test_remind_creates_missing_user(self):
        msg = mock.MagicMock()
        msg.text = "/remind 8"
        msg.from_user.id, msg.from_user.username, msg.from_user.first_name = 555, "u", "Тест"
        msg.answer = mock.AsyncMock()
        await lifequest_bot.set_reminder_time(msg)
        self.assertEqual(storage.get_user(555)["reminder_hour"], 8)


class StreakAlarmTest(TempDBTestCase):
    def test_alarm_only_when_nothing_can_save_streak(self):
        storage.ensure_user(9)
        user = storage.get_user(9)
        today = game.local_today(user)
        storage.update_user(9, streak_current=6, streak_best=6,
                            streak_last_date=(today - timedelta(days=1)).isoformat(),
                            freeze_week=game.week_key(today), freeze_week_count=1, freeze_tokens=1)
        self.assertIsNone(lifequest_bot.build_streak_alarm(9)[0])  # есть заморозка в запасе
        storage.update_user(9, freeze_tokens=0)
        text, kb = lifequest_bot.build_streak_alarm(9)
        self.assertIn("Серия 6 дней сгорит", text)
        storage.update_user(9, streak_push_date=today.isoformat())
        self.assertIsNone(lifequest_bot.build_streak_alarm(9)[0])  # не чаще раза в день

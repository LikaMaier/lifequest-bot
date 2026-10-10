import os
import tempfile
import unittest
from datetime import datetime, timedelta
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


class DailyQuestPushTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(7)
        storage.update_user(7, tz="Europe/Moscow")
        self.sent = []

        async def fake_send(chat_id, text, **kw):
            self.sent.append((chat_id, text, kw.get("reply_markup")))
        self.patch = mock.patch.object(lifequest_bot.bot, "send_message", side_effect=fake_send)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        TempDBTestCase.tearDown(self)

    def _daily(self):
        today = game.local_today(storage.get_user(7))
        return game.daily_quest_id(today), game.CATALOG[game.daily_quest_id(today)]

    async def test_morning_push_has_daily_quest(self):
        key, q = self._daily()
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[7]):
            await lifequest_bot.send_daily_reminders()
        self.assertEqual(len(self.sent), 1)  # планов нет — только одно сообщение
        _, text, kb = self.sent[0]
        self.assertIn("Задание дня", text)
        self.assertIn(q["title"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), text)
        datas = [b.callback_data for row in kb.inline_keyboard for b in row]
        self.assertIn(f"daily_accept_{key}", datas)

    async def test_accept_button_hidden_after_accepting(self):
        key, _ = self._daily()
        game.accept_quest(7, key, None, daily=True)
        text, kb = lifequest_bot.build_morning_message(7)
        datas = [b.callback_data for row in kb.inline_keyboard for b in row]
        self.assertNotIn(f"daily_accept_{key}", datas)
        self.assertIn("menu_myquests", datas)

    async def test_daily_accept_callback(self):
        key, _ = self._daily()
        cb = mock.MagicMock()
        cb.from_user.id, cb.from_user.username, cb.from_user.first_name = 7, "u", "U"
        cb.data = f"daily_accept_{key}"
        cb.answer = mock.AsyncMock()
        cb.message.edit_text = mock.AsyncMock()
        await lifequest_bot.daily_accept(cb)
        cb.message.edit_text.assert_awaited_once()
        self.assertEqual(game.daily_status(7, game.local_today(storage.get_user(7))), "active")
        # Вчерашнее (не сегодняшнее) задание дня не принимается.
        cb.data = "daily_accept_not_today"
        await lifequest_bot.daily_accept(cb)
        self.assertTrue(cb.answer.await_args.kwargs.get("show_alert"))


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
        with mock.patch.object(lifequest_bot, "users_at_local_hour", return_value=[9]):
            await lifequest_bot.send_daily_reminders()
            await lifequest_bot.send_evening_reminders()
        self.assertEqual(len(self.sent), 3)  # утро, планы, вечер
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
        self.assertTrue(any(line.split("{")[0][:12] in text for line in nudges.LINES["absent"] if line.split("{")[0]))

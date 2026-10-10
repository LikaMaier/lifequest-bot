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

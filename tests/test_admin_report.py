from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.helpers import TempDBTestCase
import admin_report
import friends
import habits
import storage

ADMIN = 503303776
UTC = ZoneInfo("UTC")


class AdminReportTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        self.now = datetime(2026, 10, 18, 9, 30, tzinfo=UTC)  # 12:30 по Москве
        storage.ensure_user(ADMIN, "owner", "Лика")
        storage.update_user(ADMIN, tz="Europe/Moscow")
        self._user(11, "Ира", "ira", self.now - timedelta(hours=2))
        self._user(12, "Вера", None, self.now - timedelta(days=2))
        self._user(13, "Оля", "olya", self.now - timedelta(days=20))  # вне 7 дней
        storage.update_user(12, referred_by=11, onboarded=1)
        friends.add_friend(11, 12)
        for _ in range(3):
            habits.create_habit(11, {"title": f"Привычка {_}", "target": 1})
        storage.set_blocked(13)

    def _user(self, uid, name, username, created):
        storage.ensure_user(uid, username, name)
        conn = storage.connect()
        conn.execute("UPDATE users SET created_at = ? WHERE user_id = ?", (created.strftime("%Y-%m-%d %H:%M:%S"), uid))
        conn.commit()
        conn.close()

    def test_week_report(self):
        parts = admin_report.report(7, ADMIN, self.now)
        text = "\n".join(parts)
        self.assertIn("Новых: <b>2</b>", text)
        self.assertIn("всего в боте: 3", text)  # без владелицы
        self.assertIn("Ира", text)
        self.assertIn("@ira", text)
        self.assertIn("<code>11</code>", text)
        self.assertIn("по приглашению: Ира", text)
        self.assertIn("по приглашению друга: 1", text)
        self.assertIn("привычки 3", text)
        self.assertIn("друзья 1", text)
        self.assertNotIn("Оля", text)  # пришла 20 дней назад
        self.assertNotIn("Лика", text)  # сама владелица не считается

    def test_today_and_month(self):
        today = "\n".join(admin_report.report(1, ADMIN, self.now))
        self.assertIn("сегодня", today)
        self.assertIn("Новых: <b>1</b>", today)
        month = "\n".join(admin_report.report(30, ADMIN, self.now))
        self.assertIn("Новых: <b>3</b>", month)
        self.assertIn("⛔", month)  # Оля заблокировала бота

    def test_empty_and_chunks(self):
        empty = admin_report.report(1, ADMIN, self.now + timedelta(days=60))
        self.assertIn("Новых пользователей нет", empty[0])
        for i in range(60):
            self._user(1000 + i, f"Гость {i} " + "о" * 40, f"guest{i}", self.now - timedelta(minutes=i + 1))
        parts = admin_report.report(1, ADMIN, self.now)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(p) <= 4096 for p in parts))
        self.assertIn("…и ещё", parts[-1])

    def test_daily_digest_once_at_10(self):
        at_10 = datetime(2026, 10, 19, 7, 5, tzinfo=UTC)  # 10:05 по Москве, вчера — 18.10
        self.assertEqual(admin_report.daily_digest(ADMIN, at_10 - timedelta(hours=1)), [])  # 9 утра — рано
        parts = admin_report.daily_digest(ADMIN, at_10)
        self.assertEqual(len(parts), 1)
        self.assertIn("за вчера, 18.10", parts[0])
        self.assertIn("Ира", parts[0])
        self.assertEqual(admin_report.daily_digest(ADMIN, at_10), [])  # второй раз не шлём

    def test_digest_silent_when_nobody_new(self):
        at_10 = datetime(2026, 11, 30, 7, 5, tzinfo=UTC)
        self.assertEqual(admin_report.daily_digest(ADMIN, at_10), [])

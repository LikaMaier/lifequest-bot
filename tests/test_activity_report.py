from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.helpers import TempDBTestCase
import activity_report
import storage

ADMIN = 503303776
UTC = ZoneInfo("UTC")


class ActivityReportTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        self.now = datetime(2026, 10, 18, 9, 30, tzinfo=UTC)  # 12:30 по Москве
        self.ts = self.now.strftime("%Y-%m-%d %H:%M:%S")
        self.day = "2026-10-18"
        storage.ensure_user(ADMIN, "owner", "Лика")
        storage.update_user(ADMIN, tz="Europe/Moscow")
        storage.ensure_user(11, "ira", "Ира")
        storage.ensure_user(12, None, "Вера")
        conn = storage.connect()
        ts, day = self.ts, self.day
        for uid in (11, 12, ADMIN):
            conn.execute("UPDATE users SET last_seen_at = ? WHERE user_id = ?", (ts, uid))
        conn.execute("INSERT INTO habits (id, user_id, title, emoji, created_at) VALUES (1, 11, 'Вода', '💧', ?)", (ts,))
        conn.execute("INSERT INTO habit_logs (habit_id, user_id, local_date, count, done) VALUES (1, 11, ?, 1, 1)", (day,))
        conn.execute("""INSERT INTO quest_history (user_id, quest_key, title, status, accepted_at, completed_at, local_date)
                        VALUES (11, 'q1', 'Пикник <на крыше>', 'done', ?, ?, ?)""", (ts, ts, day))
        conn.execute("INSERT INTO plans (user_id, date, title, created_at) VALUES (11, ?, 'Купить хлеб', ?)", (day, ts))
        conn.execute("INSERT INTO notes (user_id, text, day, created_at, updated_at) VALUES (11, 'x', ?, ?, ?)", (day, ts, ts))
        conn.execute("INSERT INTO day_moods (user_id, day, mood, updated_at) VALUES (11, ?, 'great', ?)", (day, ts))
        conn.execute("INSERT INTO xp_log (user_id, amount, reason, local_date, created_at) VALUES (11, 30, 'q', ?, ?)", (day, ts))
        conn.execute("INSERT INTO habits (id, user_id, title, created_at) VALUES (2, ?, 'Своя', ?)", (ADMIN, ts))
        # вчерашнее — в сегодняшний отчёт не попадает
        old = (self.now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("INSERT INTO plans (user_id, date, title, created_at) VALUES (12, '2026-10-17', 'Старое', ?)", (old,))
        conn.commit()
        conn.close()

    def test_today_lists_who_did_what(self):
        text = "\n".join(activity_report.report(0, ADMIN, self.now))
        self.assertIn("Активность сегодня", text)
        self.assertIn("<b>Ира</b> @ira", text)
        self.assertIn("+30 XP", text)
        self.assertIn("«💧 Вода»", text)
        self.assertIn("«Пикник &lt;на крыше&gt;»", text)
        self.assertIn("добавил(а) планы: «Купить хлеб»", text)
        self.assertIn("📝 заметок: 1", text)
        self.assertIn("🤩", text)
        self.assertIn("Только заходили:</b> Вера", text)
        self.assertNotIn("Старое", text)
        self.assertNotIn("Лика", text)  # владелица — не в отчёте
        self.assertNotIn("Своя", text)

    def test_yesterday_and_daily_digest_once(self):
        self.assertIn("Вера", "\n".join(activity_report.report(1, ADMIN, self.now)))
        morning = datetime(2026, 10, 19, 7, 5, tzinfo=UTC)  # 10:05 по Москве
        parts = activity_report.daily_digest(ADMIN, morning)
        self.assertIn("Ира", "\n".join(parts))
        self.assertEqual(activity_report.daily_digest(ADMIN, morning), [])
        self.assertEqual(activity_report.daily_digest(ADMIN, morning + timedelta(hours=2)), [])

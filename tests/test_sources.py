from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.helpers import TempDBTestCase
import admin_report
import friends
import habits
import sources
import storage

ADMIN = 503303776


class SourcesTest(TempDBTestCase):
    def test_clean_and_payload(self):
        self.assertEqual(sources.from_payload("src_TikTok"), "tiktok")
        self.assertEqual(sources.from_payload("src_blogger_anya"), "blogger_anya")
        self.assertEqual(sources.from_payload("src_Блог!"), None)
        self.assertIsNone(sources.from_payload("ref_123"))
        self.assertIsNone(sources.from_payload(""))
        self.assertEqual(len(sources.clean("x" * 80)), sources.MAX_LEN)
        self.assertEqual(sources.link("lqbot", "VK"), "https://t.me/lqbot?start=src_vk")

    def test_record_only_first_time_and_only_new(self):
        storage.ensure_user(1, "a", "Ира")
        self.assertTrue(sources.record(1, "src_tiktok", True))
        self.assertFalse(sources.record(1, "src_vk", True))  # метка не перезаписывается
        self.assertEqual(storage.get_user(1)["source"], "tiktok")
        storage.ensure_user(2, "b", "Вера")
        self.assertFalse(sources.record(2, "src_vk", False))  # старый пользователь — не трогаем
        self.assertIsNone(storage.get_user(2).get("source"))

    def test_of_friend_and_direct(self):
        storage.ensure_user(1, None, "Ира")
        storage.ensure_user(2, None, "Вера")
        storage.update_user(2, referred_by=1)
        self.assertEqual(sources.of(storage.get_user(1)), sources.DIRECT)
        self.assertEqual(sources.of(storage.get_user(2)), sources.FRIEND)

    def test_report_breakdown(self):
        now = datetime(2026, 11, 3, 12, 0, tzinfo=ZoneInfo("UTC"))
        storage.ensure_user(ADMIN, "owner", "Лика")
        for uid, name in ((11, "Ира"), (12, "Вера"), (13, "Оля")):
            storage.ensure_user(uid, None, name)
            conn = storage.connect()
            conn.execute("UPDATE users SET created_at = ? WHERE user_id = ?",
                         ((now - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"), uid))
            conn.commit()
            conn.close()
        sources.record(11, "src_tiktok", True)
        sources.record(12, "src_tiktok", True)
        friends.handle_join(13, 11, True)
        hid = habits.create_habit(11, {"title": "Вода", "target": 1})
        text = "\n".join(admin_report.report(7, ADMIN, now))
        self.assertIn("Откуда пришли", text)
        self.assertIn("🏷 tiktok — 2", text)
        self.assertIn("🤝 друг позвал — 1", text)
        self.assertIn("метка: tiktok", text)
        stats = admin_report.sources_report(30, ADMIN, now)
        self.assertIn("Новых: <b>3</b>", stats)
        self.assertIn("🏷 tiktok — 2", stats)

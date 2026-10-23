from unittest import mock

from tests.helpers import TempDBTestCase
import admin_tools
import friends
import game
import storage


class OwnerResetTest(TempDBTestCase):
    def test_owner_free_view(self):
        for uid, name in ((1, "Лика"), (2, "Алексей"), (3, "Оля")):
            storage.ensure_user(uid)
            storage.update_user(uid, first_name=name)
            game.add_xp(uid, 50, "test", "2026-10-20")
        storage.update_user(1, is_premium=1, premium_until="2999-01-01 00:00:00")
        friends.add_friend(1, 2)
        friends.add_friend(1, 3)
        with mock.patch.object(game, "PREMIUM_USER_IDS", set()):
            report = admin_tools.owner_free_view(1)
        self.assertFalse(game.is_premium(storage.get_user(1)))
        self.assertEqual(storage.get_user(1)["xp"], 0)
        self.assertEqual(storage.get_user(2)["xp"], 0)
        self.assertEqual(storage.get_user(3)["xp"], 50)  # остальных не трогаем
        conn = storage.connect()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM xp_log WHERE user_id IN (1, 2)").fetchone()[0], 0)
        conn.close()
        self.assertIn("Алексей", report)

    def test_env_premium_is_reported(self):
        storage.ensure_user(1)
        with mock.patch.object(game, "PREMIUM_USER_IDS", {1}):
            self.assertIn("PREMIUM_USER_IDS", admin_tools.owner_free_view(1))

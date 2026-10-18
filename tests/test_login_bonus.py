from datetime import date, timedelta
from unittest import mock

from tests.helpers import TempDBTestCase
import login_bonus
import storage


class LoginBonusTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.day = date(2026, 10, 1)

    def _claim(self):
        with mock.patch.object(login_bonus.game, "local_today", lambda u: self.day):
            return login_bonus.claim(1)

    def test_rewards_grow(self):
        self.assertEqual([login_bonus.reward(d) for d in range(1, 9)], [10, 15, 20, 25, 30, 35, 80, 45])
        self.assertEqual(login_bonus.reward(30), 60)
        self.assertEqual(login_bonus.reward(14), 120)

    def test_streak_once_a_day_and_reset(self):
        r = self._claim()
        self.assertEqual((r["claimed"], r["xp"]), (True, 10))
        self.assertFalse(self._claim()["claimed"])  # второй раз за день — нет
        self.day += timedelta(days=1)
        r = self._claim()
        self.assertEqual((r["xp"], r["login"]["day"]), (15, 2))
        self.assertEqual(r["login"]["next_xp"], 20)
        self.assertEqual(storage.get_user(1)["xp"], 25)
        self.day += timedelta(days=3)  # пропуск — заново
        r = self._claim()
        self.assertEqual((r["xp"], r["login"]["day"]), (10, 1))

    def test_track(self):
        for _ in range(8):
            self._claim()
            self.day += timedelta(days=1)
        with mock.patch.object(login_bonus.game, "local_today", lambda u: self.day):
            st = login_bonus.status(1)
        self.assertEqual((st["day"], st["claimed"]), (9, False))
        self.assertEqual([t["day"] for t in st["track"]], list(range(8, 15)))
        self.assertEqual([t["state"] for t in st["track"][:3]], ["done", "today", "next"])

    def test_mascot_every_seventh_day(self):
        import game
        self.assertEqual(game.mascots_open(storage.get_user(1)), 1)  # новичок — только «Сирень»
        self.assertFalse(game.mascot_allowed(storage.get_user(1), "star"))
        res = None
        for _ in range(7):
            res = self._claim()
            self.day += timedelta(days=1)
        self.assertEqual(res["mascot"]["id"], "star")
        self.assertEqual((res["login"]["next_mascot"]["id"], res["login"]["next_mascot"]["in_days"]), ("frog", 7))
        self.assertTrue(game.mascot_allowed(storage.get_user(1), "star"))
        game.update_settings(1, {"mascot": "star"})
        with self.assertRaises(game.QuestError):
            game.update_settings(1, {"mascot": "frog"})
        st = game.get_state(1)["unlocks"]["mascots"]
        self.assertEqual([m["unlocked"] for m in st[:3]], [True, True, False])
        self.assertTrue(st[2]["next"])

    def test_existing_player_keeps_level_mascots(self):
        import game
        storage.ensure_user(2)
        storage.update_user(2, xp=2000)
        n = game.mascots_open(storage.get_user(2))
        self.assertGreater(n, 2)
        self.assertEqual(storage.get_user(2)["mascots_open"], n)

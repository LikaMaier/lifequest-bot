from datetime import date, timedelta
import os
from unittest import mock

from tests.helpers import TempDBTestCase
import challenges
import game
import packs
import storage
from quests_database import CATALOG


def _done(user_id, day: date, sphere=None, key="x"):
    conn = storage.connect()
    conn.execute("INSERT INTO quest_history (user_id, quest_key, status, local_date, sphere) VALUES (?, ?, 'done', ?, ?)",
                 (user_id, key, day.isoformat(), sphere))
    conn.commit()
    conn.close()


class ChallengeTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")
        self.today = game.local_today(storage.get_user(1))

    def _shift_start(self, days_ago):
        conn = storage.connect()
        conn.execute("UPDATE user_challenges SET start_date = ? WHERE user_id = 1",
                     ((self.today - timedelta(days=days_ago)).isoformat(),))
        conn.commit()
        conn.close()

    def test_complete_awards_xp_once(self):
        challenges.start(1, "brave7")
        self._shift_start(6)
        for i in range(7):
            _done(1, self.today - timedelta(days=i), "Смелость")
        res = challenges.check(1)
        self.assertEqual(res["completed"]["xp"], 150)
        self.assertEqual(storage.get_user(1)["xp"], 150)
        self.assertEqual(challenges.check(1), {})
        self.assertIsNone(challenges.summary(1))
        self.assertEqual(next(c for c in challenges.view(1)["list"] if c["id"] == "brave7")["wins"], 1)

    def test_wrong_sphere_and_missed_day_fails(self):
        challenges.start(1, "energy7")
        self._shift_start(2)
        _done(1, self.today - timedelta(days=2), "Энергия")
        _done(1, self.today - timedelta(days=1), "Смелость")  # не та сфера
        self.assertIn("failed", challenges.check(1))
        challenges.start(1, "any14")  # после провала можно начать новый
        self.assertEqual(challenges.summary(1)["id"], "any14")

    def test_one_active_and_premium_only(self):
        challenges.start(1, "any14")
        with self.assertRaises(game.QuestError):
            challenges.start(1, "brave7")
        challenges.quit_active(1)
        with self.assertRaises(game.QuestError) as err:
            challenges.start(1, "any30")
        self.assertEqual(err.exception.code, "challenge")
        storage.update_user(1, is_premium=1)
        challenges.start(1, "any30")

    def test_today_not_failed_yet(self):
        challenges.start(1, "any14")
        self._shift_start(1)
        _done(1, self.today - timedelta(days=1))
        p = challenges.progress(1)
        self.assertFalse(p["failed"])
        self.assertFalse(p["today_done"])
        self.assertEqual((p["day"], p["done"]), (2, 1))


class PacksTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")

    def test_packs_not_in_random_or_daily(self):
        pool_keys = {q["id"] for q in CATALOG.values() if q.get("pack")}
        self.assertTrue(pool_keys)
        for d in range(60):
            self.assertNotIn(game.daily_quest_id(date(2026, 1, 1) + timedelta(days=d)), pool_keys)
        storage.update_user(1, is_premium=1)
        for _ in range(30):
            self.assertNotIn(game.random_quest(1, "solo")["id"], pool_keys)

    def test_free_then_premium_lock(self):
        free = packs.quest_id("weekend", 0)
        paid = packs.quest_id("weekend", packs.FREE_PER_PACK)
        game.accept_quest(1, free)
        with self.assertRaises(game.QuestError) as err:
            game.accept_quest(1, paid)
        self.assertEqual(err.exception.code, "pack")
        storage.update_user(1, is_premium=1)
        game.accept_quest(1, paid)
        self.assertNotIn("weekend", [p["id"] for p in game.packs_view(1)])  # скрыт у всех…
        with mock.patch.dict(os.environ, {"ADMIN_ID": "1"}):  # …кроме владелицы
            view = {p["id"]: p for p in game.packs_view(1)}
        statuses = [q["status"] for q in view["weekend"]["quests"]]
        self.assertEqual(statuses.count("active"), 2)

    def test_seasonal_pack_and_item(self):
        with mock.patch.object(game, "local_today", return_value=date(2026, 12, 1)):
            self.assertNotIn("halloween", [p["id"] for p in game.packs_view(1)])
            with self.assertRaises(game.QuestError):
                game.accept_quest(1, packs.quest_id("halloween", 0))
            self.assertNotIn("pumpkin", [i["id"] for i in game.shop_view(1)["items"]])
        storage.update_user(1, xp=500)
        with mock.patch.object(game, "local_today", return_value=date(2026, 10, 20)):
            self.assertIn("halloween", [p["id"] for p in game.packs_view(1)])
            game.buy(1, "pumpkin")
        with mock.patch.object(game, "local_today", return_value=date(2026, 12, 1)):
            item = next(i for i in game.shop_view(1)["items"] if i["id"] == "pumpkin")
            self.assertTrue(item["owned"])  # купленное остаётся

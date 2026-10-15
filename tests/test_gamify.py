import random

from tests.helpers import TempDBTestCase
import chest
import friends
import game
import habits
import plans
import storage


class ChestTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.ids = [habits.create_habit(1, {"title": f"H{i}", "target": 1})["habit"]["id"] for i in range(4)]

    def test_needs_three_habits(self):
        st = chest.status(1)
        self.assertEqual((st["need"], st["have"], st["ready"]), (3, 0, False))
        with self.assertRaises(game.QuestError):
            chest.open_chest(1)
        for hid in self.ids[:3]:
            habits.log_habit(1, hid, delta=1)
        self.assertTrue(chest.status(1)["ready"])

    def test_open_once_and_reward(self):
        for hid in self.ids[:3]:
            habits.log_habit(1, hid, delta=1)
        xp = storage.get_user(1).get("xp") or 0
        res = chest.open_chest(1, rng=random.Random(1))
        r = res["reward"]
        u = storage.get_user(1)
        if r["kind"] == "xp":
            self.assertEqual(u["xp"], xp + r["amount"])
        else:
            self.assertEqual(u["freeze_tokens"], 1)
        st = chest.status(1)
        self.assertTrue(st["opened"])
        self.assertFalse(st["ready"])
        self.assertEqual(st["reward"], r)
        with self.assertRaises(game.QuestError):
            chest.open_chest(1)

    def test_fewer_habits_need_all(self):
        storage.ensure_user(2)
        hid = habits.create_habit(2, {"title": "Одна", "target": 1})["habit"]["id"]
        self.assertEqual(chest.status(2)["need"], 1)
        habits.log_habit(2, hid, delta=1)
        self.assertTrue(chest.status(2)["ready"])

    def test_freeze_full_gives_xp(self):
        storage.update_user(1, freeze_tokens=game.FREEZE_MAX)

        class Fixed:
            def uniform(self, a, b):
                return 85  # попадает в «заморозку»
        self.assertEqual(chest._roll(storage.get_user(1), Fixed())["kind"], "xp")
        storage.update_user(1, freeze_tokens=0)
        self.assertEqual(chest._roll(storage.get_user(1), Fixed())["kind"], "freeze")


class LeagueTest(TempDBTestCase):
    def test_points(self):
        storage.ensure_user(1)
        storage.ensure_user(2)
        friends.add_friend(1, 2)
        hid = habits.create_habit(2, {"title": "Вода", "target": 1})["habit"]["id"]
        habits.log_habit(2, hid, delta=1)
        today = game.local_today(storage.get_user(2)).isoformat()
        p = plans.create_plan(2, {"title": "Дело", "date": today})
        plans.complete_plan(2, p["id"], today)
        view = friends.list_view(1)
        f = view["friends"][0]
        self.assertEqual((f["week_habits"], f["week_plans"], f["points"]), (1, 1, 2))
        self.assertEqual(view["me"]["points"], 0)
        self.assertIn("days_left", view)

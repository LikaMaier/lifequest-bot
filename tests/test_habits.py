from datetime import timedelta

from tests.helpers import TempDBTestCase
import game
import habits
import storage


class HabitsTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.today = game.local_today(storage.get_user(1))

    def make(self, **kw):
        data = {"title": "Пить воду", "emoji": "💧", "color": "blue", "target": 3, "unit": "стакана"}
        data.update(kw)
        return habits.create_habit(1, data)["habit"]

    def test_create_validates_and_limits(self):
        hb = self.make(title="  Пить   воду  ", target=999, color="neon")
        self.assertEqual((hb["title"], hb["target"], hb["color"]), ("Пить воду", habits.TARGET_MAX, "lime"))
        with self.assertRaises(game.QuestError):
            habits.create_habit(1, {"title": "   "})
        for i in range(habits.HABITS_LIMIT - 1):
            self.make(title=f"h{i}")
        with self.assertRaises(game.QuestError):
            self.make(title="лишняя")

    def test_counter_and_xp_once_per_day(self):
        hb = self.make()
        r1 = habits.log_habit(1, hb["id"], delta=1)
        self.assertEqual((r1["habit"]["today"], r1["xp"], r1["habit"]["done_today"]), (1, 0, False))
        habits.log_habit(1, hb["id"], delta=1)
        r3 = habits.log_habit(1, hb["id"], delta=1)
        self.assertTrue(r3["habit"]["done_today"])
        self.assertTrue(r3["just_done"])
        self.assertEqual(r3["xp"], habits.HABIT_XP)
        self.assertIn("habit_first", [a["code"] for a in r3["new_achievements"]])
        # сняли и снова отметили — XP повторно не даётся
        habits.log_habit(1, hb["id"], delta=-1)
        again = habits.log_habit(1, hb["id"], delta=1)
        self.assertEqual(again["xp"], 0)
        self.assertEqual(storage.get_user(1)["xp"], habits.HABIT_XP)
        # не уходит ниже нуля
        self.assertEqual(habits.log_habit(1, hb["id"], count=-5)["habit"]["today"], 0)

    def test_streak_and_past_days(self):
        hb = self.make(target=1)
        for i in (3, 2, 1):
            habits.log_habit(1, hb["id"], count=1, day=(self.today - timedelta(days=i)).isoformat())
        view = habits.habit_view(1, hb["id"])
        self.assertEqual(view["streak"], 3)  # сегодня ещё не отмечено — серия не сгорает
        habits.log_habit(1, hb["id"], delta=1)
        self.assertEqual(habits.habit_view(1, hb["id"])["streak"], 4)
        with self.assertRaises(game.QuestError):
            habits.log_habit(1, hb["id"], count=1, day=(self.today - timedelta(days=10)).isoformat())
        with self.assertRaises(game.QuestError):
            habits.log_habit(1, hb["id"], count=1, day=(self.today + timedelta(days=1)).isoformat())

    def test_target_change_recomputes_today(self):
        hb = self.make(target=3)
        habits.log_habit(1, hb["id"], count=2)
        self.assertFalse(habits.habit_view(1, hb["id"])["done_today"])
        habits.update_habit(1, hb["id"], {"target": 2})
        self.assertTrue(habits.habit_view(1, hb["id"])["done_today"])

    def test_delete_and_ownership(self):
        hb = self.make()
        storage.ensure_user(2)
        with self.assertRaises(game.QuestError):
            habits.log_habit(2, hb["id"], delta=1)
        with self.assertRaises(game.QuestError):
            habits.delete_habit(2, hb["id"])
        habits.delete_habit(1, hb["id"])
        self.assertEqual(habits.habits_view(1), [])
        with self.assertRaises(game.QuestError):
            habits.log_habit(1, hb["id"], delta=1)

    def test_longest_run_metric(self):
        hb = self.make(target=1)
        for i in range(7):
            habits.log_habit(1, hb["id"], count=1, day=(self.today - timedelta(days=i)).isoformat())
        self.assertEqual(game.achievement_metrics(1)["habit_streak"], 7)
        game.check_achievements(1)
        codes = [a["code"] for a in game.achievements_view(1) if a["unlocked"]]
        self.assertIn("habit_streak_7", codes)

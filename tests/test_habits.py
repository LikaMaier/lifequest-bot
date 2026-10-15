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


class EveningTextTest(TempDBTestCase):
    def test_lists_left_and_done_and_escapes(self):
        storage.ensure_user(3)
        self.assertEqual(habits.evening_text(3), "")
        water = habits.create_habit(3, {"title": "Вода", "emoji": "💧", "target": 8, "unit": "стаканов"})["habit"]
        tricky = habits.create_habit(3, {"title": "<b>Чтение</b> & отдых", "target": 1})["habit"]
        habits.log_habit(3, water["id"], count=3)
        text = habits.evening_text(3)
        self.assertIn("Привычки: 0 из 2", text)
        self.assertIn("Вода — 3/8 стаканов", text)
        self.assertIn("&lt;b&gt;Чтение&lt;/b&gt; &amp; отдых", text)
        self.assertNotIn("<b>Чтение", text)
        habits.log_habit(3, tricky["id"], delta=1)
        habits.log_habit(3, water["id"], count=8)
        self.assertIn("Все привычки на сегодня выполнены", habits.evening_text(3))


class HabitStreakTest(TempDBTestCase):
    """Серия дней считается по привычкам, а не по квестам."""

    def setUp(self):
        super().setUp()
        import habits as hb
        self.hb = hb
        storage.ensure_user(3)
        self.today = game.local_today(storage.get_user(3))
        self.h1 = hb.create_habit(3, {"title": "Вода", "target": 1})["habit"]["id"]
        self.h2 = hb.create_habit(3, {"title": "Чтение", "target": 1})["habit"]["id"]

    def test_habit_extends_streak_once_per_day_and_untick_restores(self):
        yesterday = (self.today - timedelta(days=1)).isoformat()
        storage.update_user(3, streak_current=4, streak_best=4, streak_last_date=yesterday)
        r = self.hb.log_habit(3, self.h1, delta=1)
        self.assertEqual(r["streak"]["streak"], 5)
        self.assertIsNone(self.hb.log_habit(3, self.h2, delta=1)["streak"])  # второй раз за день — без изменений
        self.assertEqual(storage.get_user(3)["streak_current"], 5)
        self.hb.log_habit(3, self.h2, delta=-1)
        self.assertEqual(storage.get_user(3)["streak_current"], 5)  # одна привычка ещё выполнена
        self.hb.log_habit(3, self.h1, delta=-1)
        u = storage.get_user(3)
        self.assertEqual((u["streak_current"], u["streak_last_date"]), (4, yesterday))

    def test_quest_does_not_move_streak(self):
        res = game.accept_quest(3, "two_truths")
        game.complete_quest(3, res["active_id"])
        self.assertEqual(storage.get_user(3)["streak_current"] or 0, 0)

    def test_backfilling_yesterday_keeps_streak(self):
        two_ago = (self.today - timedelta(days=2)).isoformat()
        storage.update_user(3, streak_current=3, streak_best=3, streak_last_date=two_ago)
        self.hb.log_habit(3, self.h1, delta=1, day=(self.today - timedelta(days=1)).isoformat())
        self.assertEqual(storage.get_user(3)["streak_current"], 4)
        self.hb.log_habit(3, self.h1, delta=1)
        self.assertEqual(storage.get_user(3)["streak_current"], 5)


class HabitSphereTest(TempDBTestCase):
    def test_sphere_saved_and_counted(self):
        storage.ensure_user(4)
        today = game.local_today(storage.get_user(4))
        hb = habits.create_habit(4, {"title": "Зарядка", "target": 1, "sphere": "Энергия"})["habit"]
        self.assertEqual(hb["sphere"], "Энергия")
        bad = habits.create_habit(4, {"title": "Что-то", "sphere": "Котики"})["habit"]
        self.assertIsNone(bad["sphere"])
        habits.log_habit(4, hb["id"], delta=1)
        habits.log_habit(4, bad["id"], delta=1)
        self.assertEqual(habits.done_by_sphere(4, today, today), {"Энергия": 1})
        habits.update_habit(4, bad["id"], {"sphere": "Творчество"})
        self.assertEqual(habits.done_by_sphere(4, today, today), {"Энергия": 1, "Творчество": 1})


class UserSpheresTest(TempDBTestCase):
    def test_custom_and_renamed_spheres(self):
        import spheres
        storage.ensure_user(5)
        lst = spheres.create(5, {"name": "Семья", "emoji": "👨‍👩‍👧", "color": "pink"})
        fam = next(s for s in lst if s["name"] == "Семья")
        self.assertTrue(fam["custom"])
        with self.assertRaises(game.QuestError):
            spheres.create(5, {"name": "семья"})
        spheres.update(5, "Энергия", {"name": "Здоровье", "emoji": "💪"})
        en = next(s for s in spheres.list_spheres(5) if s["key"] == "Энергия")
        self.assertEqual((en["name"], en["emoji"]), ("Здоровье", "💪"))
        hb = habits.create_habit(5, {"title": "Звонок маме", "sphere": fam["key"]})["habit"]
        self.assertEqual(hb["sphere"], fam["key"])
        other = habits.create_habit(6 if storage.ensure_user(6) or True else 6, {"title": "X", "sphere": fam["key"]})["habit"]
        self.assertIsNone(other["sphere"])  # чужая сфера не подходит
        habits.log_habit(5, hb["id"], delta=1)
        today = game.local_today(storage.get_user(5))
        self.assertEqual(habits.done_by_sphere(5, today, today), {fam["key"]: 1})
        with self.assertRaises(game.QuestError):
            spheres.delete(5, "Энергия")
        spheres.delete(5, fam["key"])
        self.assertIsNone(habits.habit_view(5, hb["id"])["sphere"])
        spheres.reset(5, "Энергия")
        self.assertEqual(next(s for s in spheres.list_spheres(5) if s["key"] == "Энергия")["name"], "Энергия")

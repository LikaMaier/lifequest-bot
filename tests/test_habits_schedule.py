from datetime import datetime, timedelta

from tests.helpers import TempDBTestCase
import game
import habits
import storage


class HabitScheduleTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.today = game.local_today(storage.get_user(1))

    def make(self, **kw):
        data = {"title": "Спорт", "target": 1}
        data.update(kw)
        return habits.create_habit(1, data)["habit"]

    def day(self, n):
        return (self.today - timedelta(days=n)).isoformat()

    def test_fields_validated(self):
        hb = self.make(schedule="days", days="1010100", time_of_day="evening", remind_time="7:05")
        self.assertEqual((hb["schedule"], hb["days"], hb["time_of_day"], hb["remind_time"]), ("days", "1010100", "evening", "07:05"))
        bad = self.make(title="x", schedule="nope", days="abc", time_of_day="?", per_week=99)
        self.assertEqual((bad["schedule"], bad["days"], bad["time_of_day"], bad["per_week"]), ("daily", "1111111", "any", 7))
        with self.assertRaises(game.QuestError):
            self.make(title="y", remind_time="25:00")

    def test_days_schedule_skips_off_days_in_streak(self):
        # только сегодня по расписанию + вчера выходной: серия не рвётся из-за выходного
        wd = self.today.weekday()
        days = ["0"] * 7
        days[wd] = "1"
        days[(wd - 2) % 7] = "1"
        hb = self.make(schedule="days", days="".join(days))
        habits.log_habit(1, hb["id"], count=1, day=self.day(2))
        habits.log_habit(1, hb["id"], count=1)
        view = habits.habit_view(1, hb["id"])
        self.assertTrue(view["due_today"])
        self.assertEqual(view["streak"], 2)
        # привычка не по расписанию сегодня — не входит в сводку дня
        days[wd] = "0"
        days[(wd + 1) % 7] = "1"
        off = self.make(title="Английский", schedule="days", days="".join(days))
        self.assertFalse(habits.habit_view(1, off["id"])["due_today"])
        s = habits.summary(1)
        self.assertEqual((s["total"], s["done"]), (1, 1))

    def test_weekly_counts_week(self):
        hb = self.make(schedule="weekly", per_week=2)
        habits.log_habit(1, hb["id"], count=1)
        view = habits.habit_view(1, hb["id"])
        self.assertEqual((view["week_done"], view["streak_unit"]), (1, "week"))
        self.assertTrue(view["due_today"])

    def test_quit_habit(self):
        hb = self.make(title="Сахар", kind="quit")
        storage.connect().execute("UPDATE habits SET created_at = ? WHERE id = ?",
                                  ((self.today - timedelta(days=5)).isoformat() + " 00:00:00", hb["id"])).connection.commit()
        view = habits.habit_view(1, hb["id"])
        self.assertEqual(view["streak"], 6)
        r = habits.log_habit(1, hb["id"], delta=1, day=self.day(1))  # срыв вчера
        self.assertEqual(r["xp"], 0)
        self.assertEqual(r["habit"]["streak"], 1)
        self.assertEqual(r["habit"]["best"], 4)
        self.assertEqual(habits.summary(1)["total"], 0)  # «бросить» не входит в план дня

    def test_skip_keeps_streak(self):
        hb = self.make()
        habits.log_habit(1, hb["id"], count=1, day=self.day(3))
        habits.skip_habit(1, hb["id"], self.day(2), "болею")
        habits.log_habit(1, hb["id"], count=1, day=self.day(1))
        view = habits.habit_view(1, hb["id"])
        self.assertEqual(view["streak"], 2)
        self.assertTrue(view["week"][4]["skipped"])

    def test_pause(self):
        hb = self.make()
        habits.log_habit(1, hb["id"], count=1, day=self.day(1))
        p = habits.set_pause(1, 3)["pause"]
        self.assertEqual(p["start"], self.today.isoformat())
        view = habits.habit_view(1, hb["id"])
        self.assertFalse(view["due_today"])
        self.assertTrue(view["paused"])
        self.assertEqual(view["streak"], 1)
        self.assertIsNone(habits.end_pause(1)["pause"])
        self.assertTrue(habits.habit_view(1, hb["id"])["due_today"])
        with self.assertRaises(game.QuestError):
            habits.set_pause(1, 99)

    def test_stats(self):
        hb = self.make()
        for i in range(1, 6):
            habits.log_habit(1, hb["id"], count=1, day=self.day(i))
        st = habits.stats(1, hb["id"])
        self.assertEqual(len(st["grid"]), 119)
        self.assertEqual(sum(1 for c in st["grid"] if c["state"] == "done"), 5)
        self.assertEqual(len(st["weekday"]), 7)
        self.assertGreater(st["rate30"], 0)

    def test_milestone_and_create_many(self):
        res = habits.create_many(1, [{"title": "Вода", "target": 8}, {"title": "Чтение"}])
        self.assertEqual(len(res["habits"]), 2)
        hb = res["habits"][1]
        for i in range(6, 0, -1):
            habits.log_habit(1, hb["id"], count=1, day=self.day(i)) if i < 7 else None
        r = habits.log_habit(1, hb["id"], count=1)
        self.assertEqual(r["milestone"]["days"], 7)

    def test_reminders(self):
        hb = self.make(remind_time="09:00")
        now = datetime.combine(self.today, datetime.min.time()).replace(hour=9, minute=3)
        due = habits.due_reminders(now)
        self.assertEqual([h["id"] for _u, h in due], [hb["id"]])
        habits.mark_reminded(hb["id"], self.today.isoformat())
        self.assertEqual(habits.due_reminders(now), [])
        late = now.replace(hour=11)
        self.assertEqual(habits.due_reminders(late), [])

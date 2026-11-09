from datetime import timedelta

from tests.helpers import TempDBTestCase
import game
import habits
import plans
import storage


class CalendarHabitFillTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.today = game.local_today(storage.get_user(1))

    def day(self, n):
        return (self.today - timedelta(days=n)).isoformat()

    def test_day_progress(self):
        a = habits.create_habit(1, {"title": "Вода", "target": 1})["habit"]
        b = habits.create_habit(1, {"title": "Спорт", "target": 1})["habit"]
        habits.create_habit(1, {"title": "Сладкое", "target": 1, "kind": "quit"})
        habits.create_habit(1, {"title": "Бассейн", "target": 1, "schedule": "weekly", "per_week": 2})
        conn = storage.connect()
        conn.execute("UPDATE habits SET created_at = ? WHERE user_id = 1", (self.day(5) + " 08:00:00",))
        conn.commit()
        conn.close()
        habits.log_habit(1, a["id"], count=1, day=self.day(1))
        habits.log_habit(1, b["id"], count=1, day=self.day(1))
        habits.log_habit(1, a["id"], count=1)
        habits.skip_habit(1, b["id"], day=self.day(2))
        p = habits.day_progress(1, self.today - timedelta(days=10), self.today + timedelta(days=3))
        self.assertEqual(p[self.day(1)], (2, 2))
        self.assertEqual(p[self.day(0)], (1, 2))
        self.assertEqual(p[self.day(2)], (0, 1))  # пропуск не считается
        self.assertNotIn(self.day(8), p)  # до создания
        self.assertNotIn((self.today + timedelta(days=1)).isoformat(), p)  # будущее

    def test_month_summary_has_habits(self):
        a = habits.create_habit(1, {"title": "Вода", "target": 1})["habit"]
        habits.log_habit(1, a["id"], count=1)
        s = plans.month_summary(1, self.today.strftime("%Y-%m"))
        d = next(x for x in s["days"] if x["date"] == self.today.isoformat())
        self.assertEqual(d["habits"], {"done": 1, "total": 1})

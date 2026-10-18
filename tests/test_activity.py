from datetime import date, timedelta

from tests.helpers import TempDBTestCase
import activity
import game
import habits
import plans
import storage


class ActivityTest(TempDBTestCase):
    def test_counts_habits_plans_quests_and_compare(self):
        storage.ensure_user(1)
        today = game.local_today(storage.get_user(1))
        hid = habits.create_habit(1, {"title": "Вода", "target": 1})["habit"]["id"]
        quit_id = habits.create_habit(1, {"title": "Не курить", "kind": "quit"})["habit"]["id"]
        habits.log_habit(1, hid, count=1)
        habits.log_habit(1, quit_id, delta=1)  # срыв — не достижение
        conn = storage.connect()  # отметка 8 дней назад (через приложение — только последние 7)
        conn.execute("INSERT INTO habit_logs (habit_id, user_id, local_date, count, done) VALUES (?, 1, ?, 1, 1)",
                     (hid, (today - timedelta(days=8)).isoformat()))
        conn.commit()
        conn.close()
        p = plans.create_plan(1, {"title": "Дело", "date": today.isoformat()})
        plans.complete_plan(1, p["id"], today.isoformat())
        r = activity.summary(1, today - timedelta(days=6), today)
        self.assertEqual(len(r["series"]), 7)
        self.assertEqual((r["totals"]["habits"], r["totals"]["plans"], r["totals"]["quests"]), (1, 1, 0))
        self.assertEqual(r["totals"]["active_days"], 1)
        self.assertEqual(r["best_day"], {"date": today.isoformat(), "total": 2})
        self.assertEqual(r["prev"]["habits"], 1)  # 8 дней назад — прошлая неделя
        self.assertIsNone(activity.summary(1, today - timedelta(days=6), today, compare=False)["prev"])

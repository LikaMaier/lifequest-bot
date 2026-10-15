from tests.helpers import TempDBTestCase
import game
import plans
import storage


class Planner2Test(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.today = game.local_today(storage.get_user(1)).isoformat()

    def test_duration_and_subtasks(self):
        o = plans.create_plan(1, {"title": "Отчёт", "date": self.today, "time": "11:00", "duration": 120,
                                  "subtasks": [{"t": "Цифры"}, "Графики", {"t": "  "}]})
        self.assertEqual((o["duration"], o["end_time"]), (120, "13:00"))
        self.assertEqual([s["t"] for s in o["subtasks"]], ["Цифры", "Графики"])
        res = plans.toggle_subtask(1, o["id"], 1, True)
        self.assertTrue(res["subtasks"][1]["done"])
        with self.assertRaises(game.QuestError):
            plans.toggle_subtask(1, o["id"], 9, True)

    def test_focus(self):
        a = plans.create_plan(1, {"title": "A", "date": self.today, "time": "09:00"})
        b = plans.create_plan(1, {"title": "B", "date": self.today, "time": "18:00"})
        plans.set_focus(1, b["id"], self.today)
        items = plans.today_plans(1)
        self.assertEqual(items[0]["id"], b["id"])
        self.assertTrue(items[0]["focus"])
        self.assertFalse(next(o for o in items if o["id"] == a["id"])["focus"])
        plans.set_focus(1, None, None)
        self.assertFalse(any(o["focus"] for o in plans.today_plans(1)))

    def test_inbox(self):
        plans.inbox_add(1, "Записаться к стоматологу")
        item = plans.inbox_add(1, "Купить подарок")["item"]
        self.assertEqual(len(plans.inbox_list(1)), 2)
        res = plans.inbox_schedule(1, item["id"], {"date": self.today, "time": "19:00"})
        self.assertEqual(res["title"], "Купить подарок")
        self.assertEqual(len(res["inbox"]), 1)
        with self.assertRaises(game.QuestError):
            plans.inbox_add(1, "   ")

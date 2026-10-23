from datetime import timedelta

from tests.helpers import TempDBTestCase
import game
import plans
import storage


class CalendarStickersTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.today = game.local_today(storage.get_user(1))

    def test_summary_has_emojis_special_and_mood(self):
        d = self.today.isoformat()
        for title in ("Пробежка", "Созвон с мамой", "🎨 Рисование", "День рождения Оли", "Что-то"):
            plans.create_plan(1, {"title": title, "date": d})
        plans.set_mood(1, d, "great")
        day = next(x for x in plans.month_summary(1, d[:7])["days"] if x["date"] == d)
        self.assertEqual(day["emojis"], ["🏃", "📞", "🎨"])  # не больше трёх
        self.assertEqual(day["special"], "День рождения Оли")
        self.assertEqual(day["mood"], "great")
        self.assertEqual((day["photos"], day["photo_thumb"]), (0, None))

    def test_mood_set_clear_and_no_future(self):
        d = self.today.isoformat()
        plans.set_mood(1, d, "ok")
        plans.set_mood(1, d, "good")  # повторно — обновляется
        self.assertEqual(plans.moods(1, d, d), {d: "good"})
        plans.set_mood(1, d, None)
        self.assertEqual(plans.moods(1, d, d), {})
        with self.assertRaises(game.QuestError):
            plans.set_mood(1, (self.today + timedelta(days=1)).isoformat(), "good")

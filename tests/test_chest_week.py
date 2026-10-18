import random

from tests.helpers import TempDBTestCase
import chest
import game
import habits
import storage


class ChestWeekOneTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        self.hid = habits.create_habit(1, {"title": "Вода", "target": 1})["habit"]["id"]

    def _open(self):
        habits.log_habit(1, self.hid, count=1)
        r = chest.open_chest(1, rng=random.Random(3))["reward"]
        storage.update_user(1, chest_day=None)  # «следующий день»
        return r

    def test_first_week_gives_items_then_xp(self):
        rewards = [self._open() for _ in range(7)]
        kinds = [r["kind"] for r in rewards]
        self.assertEqual(kinds[2], "theme")
        self.assertTrue(all(k in ("accessory", "theme") for k in kinds))
        self.assertIn(rewards[0]["id"], game.AUTUMN_ACCESSORIES)
        owned = game.owned_items(1)
        self.assertTrue(all(r["item"] in owned for r in rewards))
        self.assertEqual(len({r["item"] for r in rewards}), 7)  # без повторов
        self.assertEqual(self._open()["kind"], "accessory")  # дальше автомат выдаёт вещи, пока они не кончатся

    def test_chest_style_owned_unlocks(self):
        user = storage.get_user(1)
        self.assertTrue(game.theme_owned(user, "space"))  # «Космос» теперь открыт всем
        self.assertFalse(game.theme_owned(user, "ocean"))
        with self.assertRaises(game.QuestError):
            game.update_settings(1, {"theme": "ocean"})
        for _ in range(3):
            self._open()
        self.assertTrue(game.theme_owned(storage.get_user(1), "ocean"))
        game.update_settings(1, {"theme": "ocean"})
        self.assertEqual(game.visible_theme(storage.get_user(1)), "ocean")
        themes = {t["id"]: t for t in game.get_state(1)["unlocks"]["themes"]}
        self.assertFalse(themes["ocean"]["premium"])
        self.assertTrue(themes["matrix"]["premium"])

    def test_after_first_week_machine_gives_accessories_then_xp(self):
        storage.update_user(1, chest_opens=7)
        got = set()
        for _ in range(60):
            r = self._open()
            if r["kind"] != "accessory":
                break
            got.add(r["id"])
        self.assertTrue(len(got) >= len(game.ACCESSORIES))  # все обычные вещи + сезонные
        self.assertIn(r["kind"], ("xp", "freeze"))  # коллекция собрана — XP или заморозка

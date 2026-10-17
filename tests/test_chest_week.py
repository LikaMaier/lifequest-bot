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
        self.assertIn(self._open()["kind"], ("xp", "freeze"))  # 8-й — обычный

    def test_space_theme_owned_unlocks(self):
        user = storage.get_user(1)
        self.assertFalse(game.theme_owned(user, "space"))
        with self.assertRaises(game.QuestError):
            game.update_settings(1, {"theme": "space"})
        for _ in range(3):
            self._open()
        self.assertTrue(game.theme_owned(storage.get_user(1), "space"))
        game.update_settings(1, {"theme": "space"})
        self.assertEqual(game.visible_theme(storage.get_user(1)), "space")
        themes = {t["id"]: t for t in game.get_state(1)["unlocks"]["themes"]}
        self.assertFalse(themes["space"]["premium"])

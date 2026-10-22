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

    def _open(self, pick=None):
        habits.log_habit(1, self.hid, count=1)
        if not hasattr(self, "rng"):
            self.rng = random.Random(3)
        r = chest.open_chest(1, rng=self.rng, pick=pick)["reward"]
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
        self.assertIn(self._open()["kind"], ("accessory", "xp", "freeze"))  # дальше — автомат 70/30

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
        kinds = [self._open()["kind"] for _ in range(60)]
        merch = kinds.count("accessory")
        self.assertTrue(8 <= merch <= 28, kinds)  # примерно 30% — вещи, остальное звёздочки XP/заморозка
        for _ in range(250):
            self._open()
        owned = game.owned_items(1)
        self.assertTrue(all(a[0] in owned for a in game.ACCESSORIES))  # со временем — вся коллекция
        self.assertIn(self._open()["kind"], ("xp", "freeze"))  # коллекция собрана — только XP/заморозка

    def test_machine_gives_the_caught_capsule(self):
        storage.update_user(1, chest_opens=7)
        habits.log_habit(1, self.hid, count=1)
        pool = chest.status(1)["machine"]
        self.assertIn("crown", pool)  # в витрине — только то, чего ещё нет
        self.rng = random.Random(0)
        got = []
        for _ in range(30):
            r = self._open(pick="crown" if "crown" not in game.owned_items(1) else "tophat")
            if r["kind"] == "accessory":
                got.append(r["id"])
        self.assertEqual(got[:2], ["crown", "tophat"])  # достаётся та капсула, которую ловили
        self.assertNotIn("crown", chest.status(1)["machine"])

    def test_first_week_hat_is_the_caught_one(self):
        self._open()  # 1-й — осенний набор
        r = self._open(pick="crown")  # 2-й — шапочка: та, что поймали
        self.assertEqual(r["id"], "crown")

from tests.helpers import TempDBTestCase
import game
import packs
import storage


class NewPacksTest(TempDBTestCase):
    def test_movie_and_lab_visible_and_free_start(self):
        storage.ensure_user(1)
        ids = [p["id"] for p in game.packs_view(1)]
        self.assertIn("movie", ids)
        self.assertIn("lab", ids)
        for pid in ("movie", "lab"):
            self.assertEqual(len(packs.QUESTS[pid]), 6)
            game.accept_quest(1, packs.quest_id(pid, 0))  # первые задания — бесплатно

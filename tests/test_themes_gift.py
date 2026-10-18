from datetime import date
from unittest import mock

from tests.helpers import TempDBTestCase
import game
import storage


class ThemesGiftTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)

    def _at(self, d):
        return mock.patch.object(game, "local_today", lambda u: d)

    def test_free_themes_first(self):
        self.assertEqual([t[0] for t in game.THEMES[:2]], ["classic", "space"])
        with self._at(date(2026, 10, 20)):
            themes = {t["id"]: t["premium"] for t in game.get_state(1)["unlocks"]["themes"]}
        self.assertEqual({k for k, locked in themes.items() if not locked}, {"classic", "space"})

    def test_halloween_gift_from_oct_30(self):
        with self._at(date(2026, 10, 29)):
            self.assertFalse(game.theme_owned(storage.get_user(1), "halloween"))
            self.assertIsNone(game.gift_today(storage.get_user(1)))
        with self._at(date(2026, 10, 30)):
            self.assertEqual(game.gift_today(storage.get_user(1)), "halloween")
            game.update_settings(1, {"theme": "halloween"})
        with self._at(date(2026, 12, 1)):  # подарок навсегда
            self.assertEqual(game.visible_theme(storage.get_user(1)), "halloween")
            self.assertIsNone(game.gift_today(storage.get_user(1)))

    def test_current_theme_kept_after_lock(self):
        import sqlite3
        storage.update_user(1, theme="forest")
        conn = storage.connect()
        conn.execute("DELETE FROM meta WHERE key = 'themes_grandfathered'")
        conn.commit()
        storage._keep_current_themes(conn)
        storage._keep_current_themes(conn)  # второй раз — ничего не делает
        conn.close()
        self.assertEqual(game.visible_theme(storage.get_user(1)), "forest")
        self.assertEqual(sum(1 for i in game.owned_items(1) if i == "theme:forest"), 1)

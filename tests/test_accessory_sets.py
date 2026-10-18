import os
import re

from tests.helpers import TempDBTestCase
import game
import storage

MASCOT_JS = os.path.join(os.path.dirname(__file__), "..", "static", "assets", "js", "mascot.js")


class AccessorySetsTest(TempDBTestCase):
    def test_every_accessory_has_art(self):
        src = open(MASCOT_JS, encoding="utf-8").read()
        drawn = set(re.findall(r"^\s{2}(\w+): '", src, re.M))
        ids = {a[0] for a in (*game.ACCESSORIES, *game.SEASONAL_ACCESSORIES)} | {a[0] for a in game.PREMIUM_ACCESSORIES}
        self.assertEqual(ids - drawn, set())

    def test_halloween_set_with_pumpkin(self):
        self.assertIn("pumpkin", game.HALLOWEEN_ACCESSORIES)
        self.assertEqual(len(game.HALLOWEEN_ACCESSORIES), 5)
        storage.ensure_user(1)
        from datetime import date
        from unittest import mock
        with mock.patch.object(game, "local_today", lambda u: date(2026, 10, 20)):
            shop = game.shop_view(1)
        hw = [i["id"] for i in shop["items"] if i.get("set") == "halloween"]
        self.assertEqual(set(hw), set(game.HALLOWEEN_ACCESSORIES))
        self.assertEqual(shop["sets"][0]["id"], "halloween")

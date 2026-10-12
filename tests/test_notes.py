import unittest

from aiohttp.test_utils import AioHTTPTestCase

from tests.helpers import TempDBTestCase
from tests.test_api import TOKEN, headers
import api
import game
import notes
import storage


class NotesServiceTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        storage.ensure_user(2)
        self.today = game.local_today(storage.get_user(1)).isoformat()

    def test_crud_and_order(self):
        a = notes.create_note(1, {"text": "  первая  "})
        self.assertEqual((a["text"], a["day"], a["color"], a["pinned"]), ("первая", self.today, "yellow", False))
        b = notes.create_note(1, {"text": "старая", "day": "2026-01-02", "color": "pink"})
        notes.update_note(1, b["id"], {"pinned": True})
        listed = notes.list_notes(1)
        self.assertEqual([n["id"] for n in listed["notes"]], [b["id"], a["id"]])  # закреплённая сверху
        self.assertEqual(notes.list_notes(1, day="2026-01-02")["total"], 1)
        self.assertEqual(notes.list_notes(1, q="ПЕРВ".lower())["total"], 1)
        self.assertEqual(notes.list_notes(1, q="%")["total"], 0)  # спецсимволы LIKE экранируются
        notes.delete_note(1, a["id"])
        self.assertEqual(notes.list_notes(1)["total"], 1)

    def test_validation_and_ownership(self):
        with self.assertRaises(game.QuestError):
            notes.create_note(1, {"text": "   "})
        with self.assertRaises(game.QuestError):
            notes.create_note(1, {"text": "x" * (notes.MAX_TEXT + 1)})
        with self.assertRaises(game.QuestError):
            notes.create_note(1, {"text": "ok", "day": "не дата"})
        n = notes.create_note(1, {"text": "моё", "color": "neon"})
        self.assertEqual(n["color"], "yellow")
        for fn in (lambda: notes.get_note(2, n["id"]), lambda: notes.update_note(2, n["id"], {"text": "чужое"}),
                   lambda: notes.delete_note(2, n["id"])):
            with self.assertRaises(game.QuestError):
                fn()

    def test_home_view_and_delete_all(self):
        notes.create_note(1, {"text": "сегодня"})
        notes.create_note(1, {"text": "давно", "day": "2025-05-05"})
        pinned = notes.create_note(1, {"text": "важно", "day": "2025-05-06", "pinned": True})
        home = notes.home_view(1, game.local_today(storage.get_user(1)))
        self.assertEqual([n["text"] for n in home["items"]], ["важно", "сегодня"])
        self.assertEqual(home["total"], 3)
        self.assertEqual(pinned["pinned"], True)
        storage.delete_user_data(1)
        self.assertEqual(notes.list_notes(1)["total"], 0)


class NotesApiTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_flow(self):
        h = headers(42)
        r = await self.client.post("/api/notes", headers=h, json={"text": "Купить молоко"})
        nid = (await r.json())["note"]["id"]
        r = await self.client.patch(f"/api/notes/{nid}", headers=h, json={"pinned": True, "color": "blue"})
        self.assertEqual((await r.json())["note"]["color"], "blue")
        state = await (await self.client.get("/api/state", headers=h)).json()
        self.assertEqual(state["notes"]["items"][0]["text"], "Купить молоко")
        self.assertEqual((await self.client.patch(f"/api/notes/{nid}", headers=headers(7), json={"text": "x"})).status, 400)
        self.assertEqual((await self.client.get("/api/notes?limit=abc", headers=h)).status, 400)
        self.assertEqual((await self.client.delete(f"/api/notes/{nid}", headers=h)).status, 200)
        self.assertEqual((await (await self.client.get("/api/notes", headers=h)).json())["total"], 0)


if __name__ == "__main__":
    unittest.main()

import time
import unittest

from aiohttp.test_utils import AioHTTPTestCase

from tests.helpers import TempDBTestCase
import api
import game
import storage
from webapp_auth import sign_init_data

TOKEN = "123456789:TEST-TOKEN"


def headers(user_id=42):
    init = sign_init_data({"auth_date": int(time.time()), "user": {"id": user_id, "first_name": "Тест"}}, TOKEN)
    return {"X-Telegram-Init-Data": init, "X-Timezone": "Europe/Moscow"}


class ApiTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_requires_init_data(self):
        for path in ("/api/state", "/api/stats", "/api/board"):
            resp = await self.client.get(path)
            self.assertEqual(resp.status, 401)
        resp = await self.client.get("/api/state", headers={"X-Telegram-Init-Data": "user=%7B%22id%22%3A1%7D&hash=00"})
        self.assertEqual(resp.status, 401)

    async def test_state_creates_user_with_timezone(self):
        resp = await self.client.get("/api/state", headers=headers(42))
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["user"]["id"], 42)
        self.assertEqual(storage.get_user(42)["tz"], "Europe/Moscow")

    async def test_user_id_only_from_signature(self):
        # Попытка подменить пользователя через тело запроса ни на что не влияет.
        resp = await self.client.post("/api/quest/accept", headers=headers(42),
                                      json={"id": "two_truths", "user_id": 99})
        self.assertEqual(resp.status, 200)
        self.assertEqual(len(storage.get_active_quests(42)), 1)
        self.assertEqual(storage.get_active_quests(99), [])
        # Чужой квест закрыть нельзя.
        active_id = (await resp.json())["active_id"]
        resp = await self.client.post("/api/quest/complete", headers=headers(7), json={"active_id": active_id})
        self.assertEqual(resp.status, 404)

    async def test_full_quest_cycle(self):
        h = headers(42)
        quest = (await (await self.client.post("/api/quest/random", headers=h, json={"mode": "pair"})).json())["quest"]
        self.assertEqual(quest["mode"], "pair")
        acc = await (await self.client.post("/api/quest/accept", headers=h, json={"id": quest["id"]})).json()
        done = await self.client.post("/api/quest/complete", headers=h, json={"active_id": acc["active_id"]})
        self.assertEqual(done.status, 200)
        self.assertGreater((await done.json())["xp"], 0)
        stats = await (await self.client.get("/api/stats?range=all", headers=h)).json()
        self.assertEqual(stats["records"]["total"], 1)

    async def test_validation_errors(self):
        h = headers(42)
        self.assertEqual((await self.client.post("/api/quest/random", headers=h, json={"mode": "x"})).status, 400)
        self.assertEqual((await self.client.post("/api/settings", headers=h, json={"daily_goal": "abc"})).status, 400)
        self.assertEqual((await self.client.post("/api/settings", headers=h, json={"mascot": "pig"})).status, 400)
        self.assertEqual((await self.client.post("/api/quest/complete", headers=h, json={"active_id": "1; DROP"})).status, 400)
        resp = await self.client.post("/api/settings", headers=h, json={"daily_goal": 9})
        self.assertEqual((await resp.json())["user"]["daily_goal"], 3)

    async def test_rate_limit(self):
        h = headers(42)
        codes = [(await self.client.post("/api/quest/random", headers=h, json={"mode": "solo"})).status for _ in range(25)]
        self.assertEqual(codes.count(200), api.RATE_LIMITS["random"][0])
        self.assertIn(429, codes)

    async def test_board_roundtrip(self):
        h = headers(42)
        board = {"cells": ["<b>йога</b>"] + [""] * 8, "done": [True], "reward": "торт", "rating": 15, "notes": "x" * 1000}
        saved = await (await self.client.post("/api/board", headers=h, json={"board": board})).json()
        got = await (await self.client.get("/api/board", headers=h)).json()
        self.assertEqual(got["board"]["cells"][0], "<b>йога</b>")  # хранится как текст, экранирует фронтенд
        self.assertEqual(got["board"]["rating"], 10)
        self.assertEqual(len(got["board"]["notes"]), storage.BOARD_NOTES_MAX)
        self.assertEqual(saved["xp"], 3)

    async def test_static_and_headers(self):
        resp = await self.client.get("/")
        self.assertEqual(resp.status, 200)
        self.assertIn("LifeQuest", await resp.text())
        self.assertEqual(resp.headers.get("X-Content-Type-Options"), "nosniff")
        resp = await self.client.get("/assets/js/app.js")
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/assets/../storage.py")
        self.assertNotEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()


class HabitsApiTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_habit_flow(self):
        h = headers(42)
        self.assertEqual((await self.client.get("/api/habits")).status, 401)
        created = await (await self.client.post("/api/habits", headers=h, json={"title": "Зарядка", "target": 1})).json()
        hid = created["habit"]["id"]
        logged = await (await self.client.post("/api/habits/log", headers=h, json={"id": hid, "delta": 1})).json()
        self.assertTrue(logged["habit"]["done_today"])
        state = await (await self.client.get("/api/state", headers=h)).json()
        self.assertEqual((state["habits"]["done"], state["habits"]["total"]), (1, 1))
        # чужую привычку не изменить
        resp = await self.client.post("/api/habits/update", headers=headers(7), json={"id": hid, "title": "x"})
        self.assertEqual(resp.status, 400)
        resp = await self.client.post("/api/habits/delete", headers=h, json={"id": hid})
        self.assertEqual(resp.status, 200)
        self.assertEqual((await (await self.client.get("/api/habits", headers=h)).json())["habits"], [])


class OnboardingApiTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_onboarded_flag(self):
        h = headers(42)
        state = await (await self.client.get("/api/state", headers=h)).json()
        self.assertFalse(state["user"]["onboarded"])
        state = await (await self.client.post("/api/settings", headers=h, json={"onboarded": True})).json()
        self.assertTrue(state["user"]["onboarded"])
        state = await (await self.client.get("/api/state", headers=h)).json()
        self.assertTrue(state["user"]["onboarded"])


class ThemesAndMascotsTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_any_theme_regardless_of_level(self):
        h = headers(42)
        for theme in ("forest", "pixel", "halloween", "matrix", "ocean", "classic"):
            r = await self.client.post("/api/settings", headers=h, json={"theme": theme})
            self.assertEqual((await r.json())["user"]["theme"], theme)
        self.assertEqual((await self.client.post("/api/settings", headers=h, json={"theme": "neon"})).status, 400)

    async def test_removed_brutal_theme_falls_back_to_classic(self):
        await self.client.get("/api/state", headers=headers(42))
        storage.update_user(42, theme="brutal")
        storage.init_db()
        self.assertEqual(storage.get_user(42)["theme"], "classic")
        r = await self.client.post("/api/settings", headers=headers(42), json={"theme": "brutal"})
        self.assertEqual(r.status, 400)

    async def test_legacy_mascot_migrated(self):
        await self.client.get("/api/state", headers=headers(42))
        storage.update_user(42, mascot="cat-blue")
        storage.init_db()
        self.assertEqual(storage.get_user(42)["mascot"], "frog")
        state = await (await self.client.get("/api/state", headers=headers(42))).json()
        self.assertEqual([m["id"] for m in state["unlocks"]["mascots"]],
                         ["cat-purple", "star", "frog", "puppy", "bear", "leopard", "panda", "pig"])
        self.assertEqual(len(state["unlocks"]["themes"]), 6)


class ShopApiTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_buy_equip_and_balance(self):
        h = headers(42)
        await self.client.get("/api/state", headers=h)
        storage.update_user(42, xp=300)
        shop = await (await self.client.get("/api/shop", headers=h)).json()
        self.assertEqual(shop["balance"], 300)
        r = await self.client.post("/api/shop/buy", headers=h, json={"item": "crown"})
        data = await r.json()
        self.assertEqual(data["shop"]["balance"], 100)
        self.assertEqual(data["state"]["user"]["accessory"], "crown")  # надевается сразу
        self.assertEqual(data["state"]["level"]["xp"], 300)  # уровень не падает
        # повторно купить нельзя, на дорогое не хватает
        self.assertEqual((await self.client.post("/api/shop/buy", headers=h, json={"item": "crown"})).status, 400)
        r = await self.client.post("/api/shop/buy", headers=h, json={"item": "halo"})
        self.assertEqual(r.status, 400)
        self.assertIn("Не хватает XP", (await r.json())["error"])
        # снять и надеть только купленное
        r = await self.client.post("/api/shop/equip", headers=h, json={"item": None})
        self.assertIsNone((await r.json())["state"]["user"]["accessory"])
        self.assertEqual((await self.client.post("/api/shop/equip", headers=h, json={"item": "bow"})).status, 400)

    async def test_freeze_tokens_limit(self):
        h = headers(42)
        await self.client.get("/api/state", headers=h)
        storage.update_user(42, xp=1000)
        for _ in range(3):
            r = await self.client.post("/api/shop/buy", headers=h, json={"item": "freeze"})
            self.assertEqual(r.status, 200)
        self.assertEqual((await self.client.post("/api/shop/buy", headers=h, json={"item": "freeze"})).status, 400)
        self.assertEqual(storage.get_user(42)["freeze_tokens"], 3)
        self.assertEqual(game.balance(storage.get_user(42)), 1000 - 3 * game.FREEZE_PRICE)

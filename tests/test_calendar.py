import io
import os
import time
from datetime import date, timedelta

from aiohttp import FormData
from aiohttp.test_utils import AioHTTPTestCase

from tests.helpers import TempDBTestCase
import api
import game
import photos
import plans
import storage
from webapp_auth import sign_init_data

TOKEN = "123456789:TEST-TOKEN"


def jpeg(w=1600, h=1200, color="pink"):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


class PhotoDirMixin:
    def setUp(self):
        super().setUp()
        self._old_photos = photos.PHOTOS_DIR
        photos.PHOTOS_DIR = os.path.join(self._dir, "photos")
        photos.reset_enabled_cache()
        photos.configure(TOKEN)

    def tearDown(self):
        photos.PHOTOS_DIR = self._old_photos
        photos.reset_enabled_cache()
        super().tearDown()


class PlansServiceTest(PhotoDirMixin, TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        storage.ensure_user(2)
        self.today = game.local_today(storage.get_user(1))
        self.monday = self.today - timedelta(days=self.today.weekday())

    def test_repeat_rules(self):
        p = plans.create_plan(1, {"title": "Будни", "date": self.monday.isoformat(), "repeat_rule": "weekdays"})
        w = plans.create_plan(1, {"title": "Раз в неделю", "date": self.monday.isoformat(), "repeat_rule": "weekly"})
        occ = plans.occurrences(1, self.monday, self.monday + timedelta(days=13))
        self.assertEqual(sum(1 for o in occ if o["id"] == p["id"]), 10)
        self.assertEqual([o["date"] for o in occ if o["id"] == w["id"]],
                         [self.monday.isoformat(), (self.monday + timedelta(days=7)).isoformat()])

    def test_weekdays_started_on_weekend_starts_monday(self):
        sat = self.monday + timedelta(days=5)
        p = plans.create_plan(1, {"title": "Будни", "date": sat.isoformat(), "repeat_rule": "weekdays"})
        self.assertEqual(p["date"], (sat + timedelta(days=2)).isoformat())

    def test_series_skip_and_move_one_day(self):
        p = plans.create_plan(1, {"title": "Зарядка", "date": self.today.isoformat(), "repeat_rule": "daily"})
        tomorrow = self.today + timedelta(days=1)
        plans.skip_plan(1, p["id"], tomorrow.isoformat())
        moved = plans.move_plan(1, p["id"], (self.today + timedelta(days=2)).isoformat(), (self.today + timedelta(days=10)).isoformat())
        occ = plans.occurrences(1, self.today, self.today + timedelta(days=10))
        statuses = {(o["id"], o["date"]): o["status"] for o in occ}
        self.assertEqual(statuses[(p["id"], tomorrow.isoformat())], "skipped")
        self.assertNotIn((p["id"], (self.today + timedelta(days=2)).isoformat()), statuses)  # перенесён — исчез
        self.assertEqual(statuses[(moved["plan"]["id"], (self.today + timedelta(days=10)).isoformat())], "planned")

    def test_quest_plan_counts_like_a_quest(self):
        p = plans.create_plan(1, {"quest_key": "no_list", "tier": "easy", "date": self.today.isoformat()})
        self.assertEqual(p["mode"], "solo")
        r = plans.complete_plan(1, p["id"])
        self.assertEqual(r["xp"], 10 + game.SAME_DAY_BONUS)
        self.assertEqual(game.get_state(1)["today"]["done"], 1)
        self.assertEqual(storage.get_user(1)["streak_current"], 1)
        with self.assertRaises(game.QuestError):
            plans.complete_plan(1, p["id"])

    def test_future_and_overdue(self):
        future = plans.create_plan(1, {"title": "Потом", "date": (self.today + timedelta(days=3)).isoformat()})
        with self.assertRaises(game.QuestError):
            plans.complete_plan(1, future["id"])
        old = plans.create_plan(1, {"title": "Вчера", "date": (self.today - timedelta(days=1)).isoformat()})
        self.assertTrue(plans.occurrence(1, old["id"], self.today - timedelta(days=1))["overdue"])
        self.assertEqual(len(plans.overdue_plans(1)), 1)
        plans.move_plan(1, old["id"], None, (self.today + timedelta(days=1)).isoformat())
        self.assertEqual(plans.overdue_plans(1), [])

    def test_ownership(self):
        p = plans.create_plan(1, {"title": "Моё", "date": self.today.isoformat()})
        for fn in (lambda: plans.complete_plan(2, p["id"]), lambda: plans.delete_plan(2, p["id"]),
                   lambda: plans.update_plan(2, p["id"], {"title": "x"}), lambda: plans.move_plan(2, p["id"], None, self.today.isoformat())):
            with self.assertRaises(game.QuestError):
                fn()
        self.assertEqual(len(plans.occurrences(2, self.today, self.today)), 0)

    def test_validation(self):
        bad = [{"title": "", "date": self.today.isoformat()}, {"title": "x", "date": "завтра"},
               {"title": "x", "date": self.today.isoformat(), "time": "25:00"},
               {"title": "x", "date": self.today.isoformat(), "repeat_rule": "hourly"},
               {"title": "x", "date": (self.today + timedelta(days=5000)).isoformat()},
               {"quest_key": "nope", "date": self.today.isoformat()}]
        for data in bad:
            with self.assertRaises(game.QuestError):
                plans.create_plan(1, data)
        p = plans.create_plan(1, {"title": "x", "date": self.today.isoformat(), "remind": "at_time"})
        self.assertEqual(p["remind"], "none")  # без времени напоминать нечего

    def test_board_cell_link(self):
        storage.save_weekly_board(1, storage.normalize_board({"cells": ["Йога"] + [""] * 8}), self.today)
        p = plans.create_plan(1, {"title": "Йога", "date": self.today.isoformat(), "board_cell": 0})
        plans.complete_plan(1, p["id"])
        self.assertTrue(storage.get_weekly_board(1, self.today)["done"][0])

    def test_cascade_photo_delete(self):
        p = plans.create_plan(1, {"title": "Пикник", "date": self.today.isoformat()})
        ph = photos.save_upload(1, jpeg(), {"target": "plan", "plan_id": p["id"]})["photo"]
        full = photos.file_path(1, ph["id"], "full")
        self.assertTrue(full and os.path.exists(full))
        self.assertEqual(plans.occurrence(1, p["id"], self.today)["photos"], 1)
        plans.delete_plan(1, p["id"])
        self.assertFalse(os.path.exists(full))
        self.assertEqual(photos.list_photos(1, {}), [])

    def test_reminders_due_in_user_time(self):
        storage.update_user(1, tz="Europe/Moscow")
        p = plans.create_plan(1, {"title": "Звонок", "date": self.today.isoformat(), "time": "15:00", "remind": "hour_before"})
        from datetime import datetime
        msk_14_05 = datetime(self.today.year, self.today.month, self.today.day, 11, 5)  # 14:05 МСК в UTC
        due = plans.due_reminders(msk_14_05)
        self.assertEqual([(u, o["id"]) for u, o in due], [(1, p["id"])])
        plans.mark_reminded(p["id"], self.today.isoformat())
        self.assertEqual(plans.due_reminders(msk_14_05), [])
        self.assertEqual(plans.due_reminders(datetime(self.today.year, self.today.month, self.today.day, 9, 0)), [])

    def test_ics(self):
        plans.create_plan(1, {"title": "Кино, попкорн; друзья", "date": self.today.isoformat(), "time": "19:30", "remind": "hour_before"})
        plans.create_plan(1, {"title": "Весь день", "date": self.today.isoformat()})
        ics = plans.export_ics(1, self.today, self.today)
        self.assertTrue(ics.startswith("BEGIN:VCALENDAR\r\n") and ics.endswith("END:VCALENDAR\r\n"))
        self.assertIn("SUMMARY:Кино\\, попкорн\; друзья", ics)
        self.assertIn(f"DTSTART;VALUE=DATE:{self.today.strftime('%Y%m%d')}", ics)
        self.assertIn("TRIGGER:-PT1H", ics)
        self.assertEqual(ics.count("BEGIN:VEVENT"), 2)

    def test_summary(self):
        p = plans.create_plan(1, {"quest_key": "two_truths", "date": self.today.isoformat()})
        plans.create_plan(1, {"title": "Свой", "date": self.today.isoformat()})
        s = plans.month_summary(1, self.today.strftime("%Y-%m"))
        day = next(d for d in s["days"] if d["date"] == self.today.isoformat())
        self.assertEqual(sorted(day["modes"]), ["company", "free"])
        self.assertFalse(day["complete"])
        plans.complete_plan(1, p["id"])
        with self.assertRaises(game.QuestError):
            plans.month_summary(1, "2026-13")


class PhotosServiceTest(PhotoDirMixin, TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1)
        storage.ensure_user(2)
        self.today = game.local_today(storage.get_user(1)).isoformat()

    def test_resize_and_strip(self):
        ph = photos.save_upload(1, jpeg(4000, 3000), {"target": "day", "day": self.today})["photo"]
        self.assertEqual((ph["w"], ph["h"]), (1280, 960))
        from PIL import Image
        with Image.open(photos.file_path(1, ph["id"], "thumb")) as t:
            self.assertEqual(max(t.size), 320)

    def test_rejects_bad_content_and_limits(self):
        for raw in (b"", b"GIF89a" + b"0" * 100, b"\xff\xd8\xff" + b"broken"):
            with self.assertRaises(game.QuestError):
                photos.save_upload(1, raw, {"target": "day", "day": self.today})
        with self.assertRaises(game.QuestError):
            photos.save_upload(1, b"\xff\xd8\xff" + b"0" * (photos.MAX_BYTES + 1), {"target": "day", "day": self.today})
        for _ in range(photos.PER_ITEM):
            photos.save_upload(1, jpeg(200, 200), {"target": "day", "day": self.today})
        with self.assertRaises(game.QuestError):
            photos.save_upload(1, jpeg(200, 200), {"target": "day", "day": self.today})
        future = (date.fromisoformat(self.today) + timedelta(days=1)).isoformat()
        with self.assertRaises(game.QuestError):
            photos.save_upload(1, jpeg(200, 200), {"target": "day", "day": future})

    def test_only_owner_and_signed_urls(self):
        ph = photos.save_upload(1, jpeg(), {"target": "day", "day": self.today})["photo"]
        self.assertIsNone(photos.file_path(2, ph["id"], "full"))
        with self.assertRaises(game.QuestError):
            photos.delete_photo(2, ph["id"])
        exp = int(time.time()) + 60
        sig = photos.sign(1, ph["id"], "thumb", exp).split("sig=")[1]
        self.assertTrue(photos.verify(1, ph["id"], "thumb", exp, sig))
        self.assertFalse(photos.verify(2, ph["id"], "thumb", exp, sig))
        self.assertFalse(photos.verify(1, ph["id"], "full", exp, sig))
        self.assertFalse(photos.verify(1, ph["id"], "thumb", int(time.time()) - 1, sig))

    def test_quest_target_must_be_done(self):
        res = game.accept_quest(1, "two_truths")
        conn = storage.connect()
        hid = conn.execute("SELECT id FROM quest_history WHERE user_id = 1").fetchone()[0]
        conn.close()
        with self.assertRaises(game.QuestError):
            photos.save_upload(1, jpeg(), {"target": "quest", "quest_history_id": hid})
        game.complete_quest(1, res["active_id"])
        ph = photos.save_upload(1, jpeg(), {"target": "quest", "quest_history_id": hid})
        self.assertEqual(ph["photo"]["label"], "🕵️ Две правды одна ложь")
        self.assertIn("photo_first", [a["code"] for a in ph["new_achievements"]])
        with self.assertRaises(game.QuestError):  # чужое задание
            photos.save_upload(2, jpeg(), {"target": "quest", "quest_history_id": hid})

    def test_disabled_without_volume(self):
        photos.PHOTOS_DIR = "/proc/no-such-dir/photos"
        photos.reset_enabled_cache()
        self.assertFalse(photos.enabled())
        with self.assertRaises(game.QuestError):
            photos.save_upload(1, jpeg(), {"target": "day", "day": self.today})

    def test_orphan_cleanup_and_delete_all(self):
        ph = photos.save_upload(1, jpeg(), {"target": "day", "day": self.today})["photo"]
        stray = os.path.join(photos.PHOTOS_DIR, "1", "0" * 32 + ".jpg")
        with open(stray, "wb") as f:
            f.write(b"x")
        self.assertEqual(photos.cleanup_orphans()["files"], 1)
        self.assertTrue(photos.file_path(1, ph["id"], "full"))
        self.assertEqual(photos.delete_all(1), 1)
        self.assertFalse(os.path.exists(os.path.join(photos.PHOTOS_DIR, "1")))


def headers(user_id):
    init = sign_init_data({"auth_date": int(time.time()), "user": {"id": user_id, "first_name": "T"}}, TOKEN)
    return {"X-Telegram-Init-Data": init}


class CalendarApiTest(TempDBTestCase, AioHTTPTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        self._old_photos = photos.PHOTOS_DIR
        photos.PHOTOS_DIR = os.path.join(self._dir, "photos")
        photos.reset_enabled_cache()
        AioHTTPTestCase.setUp(self)

    def tearDown(self):
        AioHTTPTestCase.tearDown(self)
        photos.PHOTOS_DIR = self._old_photos
        photos.reset_enabled_cache()
        TempDBTestCase.tearDown(self)

    async def get_application(self):
        return api.create_app(TOKEN)

    async def test_plans_flow_and_rights(self):
        h1, h2 = headers(1), headers(2)
        today = date.today().isoformat()
        self.assertEqual((await self.client.get(f"/api/plans?from={today}&to={today}")).status, 401)
        r = await self.client.post("/api/plans", headers=h1, json={"title": "Пикник", "date": today, "user_id": 2})
        pid = (await r.json())["plan"]["id"]
        self.assertEqual((await (await self.client.get(f"/api/plans?from={today}&to={today}", headers=h2)).json())["plans"], [])
        self.assertEqual((await self.client.patch(f"/api/plans/{pid}", headers=h2, json={"title": "x"})).status, 400)
        self.assertEqual((await self.client.delete(f"/api/plans/{pid}", headers=h2)).status, 400)
        self.assertEqual((await self.client.post(f"/api/plans/{pid}/complete", headers=h2, json={})).status, 400)
        r = await self.client.post(f"/api/plans/{pid}/complete", headers=h1, json={})
        self.assertEqual((await r.json())["plan"]["status"], "done")
        r = await self.client.get(f"/api/calendar/summary?month={today[:7]}", headers=h1)
        self.assertEqual(r.status, 200)

    async def test_photo_upload_access_and_signed_get(self):
        today = date.today().isoformat()
        form = FormData()
        form.add_field("target", "day")
        form.add_field("day", today)
        form.add_field("file", jpeg(), filename="x.jpg", content_type="image/jpeg")
        r = await self.client.post("/api/photos", headers=headers(1), data=form)
        self.assertEqual(r.status, 200, await r.text())
        ph = (await r.json())["photo"]
        signed = await self.client.get("/" + ph["thumb"])
        self.assertEqual(signed.status, 200)
        self.assertEqual(signed.headers["Content-Type"], "image/jpeg")
        self.assertEqual((await self.client.get(f"/api/photos/{ph['id']}/full")).status, 401)
        self.assertEqual((await self.client.get(f"/api/photos/{ph['id']}/full", headers=headers(2))).status, 404)
        self.assertEqual((await self.client.get(f"/api/photos/{ph['id']}/full", headers=headers(1))).status, 200)
        tampered = ph["thumb"].replace("u=1", "u=2")
        self.assertEqual((await self.client.get("/" + tampered)).status, 403)
        self.assertEqual((await self.client.delete(f"/api/photos/{ph['id']}", headers=headers(2))).status, 400)
        self.assertEqual((await self.client.delete(f"/api/photos/{ph['id']}", headers=headers(1))).status, 200)

    async def test_ics_link(self):
        today = date.today().isoformat()
        await self.client.post("/api/plans", headers=headers(1), json={"title": "Кино", "date": today, "time": "19:00"})
        link = (await (await self.client.post("/api/calendar/export-link", headers=headers(1), json={"from": today, "to": today})).json())["url"]
        r = await self.client.get("/" + link)
        self.assertEqual(r.status, 200)
        self.assertIn("text/calendar", r.headers["Content-Type"])
        self.assertIn("SUMMARY:Кино", await r.text())
        self.assertEqual((await self.client.get("/" + link.replace("to=", "to=2099-"))).status, 403)

    async def test_delete_all_data(self):
        today = date.today().isoformat()
        await self.client.post("/api/plans", headers=headers(1), json={"title": "x", "date": today})
        self.assertEqual((await self.client.post("/api/me/delete-all", headers=headers(1), json={})).status, 400)
        r = await self.client.post("/api/me/delete-all", headers=headers(1), json={"confirm": "DELETE"})
        self.assertEqual(r.status, 200)
        conn = storage.connect()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM plans WHERE user_id = 1").fetchone()[0], 0)
        conn.close()

    async def test_quest_search(self):
        r = await self.client.get("/api/quests/search?q=ложь&mode=company", headers=headers(1))
        titles = [q["title"] for q in (await r.json())["quests"]]
        self.assertIn("Две правды одна ложь", titles)

from datetime import date, datetime, timedelta
from unittest import mock

from tests.helpers import TempDBTestCase
import contests
import friends
import game
import storage

CHECK = {"title": "Без сахара", "emoji": "🍬", "kind": "check", "points": 10}
COUNT = {"title": "Отжимания", "emoji": "💪", "kind": "count", "unit": "раз", "norm": 30, "points": 1}


class ContestsTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        for uid, name in ((1, "Аня"), (2, "Маша"), (3, "Оля"), (4, "Чужой")):
            storage.ensure_user(uid)
            storage.update_user(uid, first_name=name)

    def _contest(self, days=7):
        return contests.create(1, {"title": "Осенний марафон", "days": days})["contest"]

    def _ready(self, days=7):
        c = self._contest(days)
        contests.join(2, c["id"])
        contests.add_item(1, c["id"], CHECK)
        contests.add_item(1, c["id"], COUNT)
        return c["id"]

    # ---------- лобби ----------
    def test_create_makes_creator_member_and_link_parses(self):
        c = self._contest()
        self.assertEqual(c["status"], "lobby")
        self.assertTrue(c["mine"] and c["member"])
        self.assertEqual(c["members_count"], 1)
        self.assertFalse(c["can_launch"])
        self.assertEqual(friends.parse_start(f"c_{c['id']}"), ("c", c["id"], 1))
        self.assertIsNone(friends.parse_start("c_999"))

    def test_bad_days_and_created_limit(self):
        with self.assertRaises(game.QuestError):
            contests.create(1, {"title": "x", "days": 5})
        for _ in range(contests.ACTIVE_CREATED_LIMIT - 1):
            self._contest()
        self._contest()
        with self.assertRaises(game.QuestError):
            self._contest()

    def test_join_befriends_and_notifies_creator(self):
        c = self._contest()
        res = contests.join(2, c["id"])
        self.assertEqual(res["messages"][0][0], 1)
        self.assertTrue(friends.are_friends(1, 2))
        self.assertEqual(res["contest"]["members_count"], 2)
        again = contests.join(2, c["id"])
        self.assertTrue(again.get("already"))

    def test_only_creator_edits_items(self):
        c = self._contest()
        contests.join(2, c["id"])
        with self.assertRaises(game.QuestError):
            contests.add_item(2, c["id"], CHECK)
        with self.assertRaises(game.QuestError):
            contests.add_item(4, c["id"], CHECK)
        v = contests.add_item(1, c["id"], COUNT)["contest"]
        item = v["items"][0]
        self.assertEqual((item["kind"], item["unit"], item["norm"], item["points"]), ("count", "раз", 30, 1))
        v = contests.update_item(1, c["id"], item["id"], {**COUNT, "points": 2})["contest"]
        self.assertEqual(v["items"][0]["points"], 2)
        v = contests.delete_item(1, c["id"], item["id"])["contest"]
        self.assertEqual(v["items"], [])

    def test_item_validation(self):
        c = self._contest()
        with self.assertRaises(game.QuestError):
            contests.add_item(1, c["id"], {"title": "  ", "kind": "check"})
        with self.assertRaises(game.QuestError):
            contests.add_item(1, c["id"], {**COUNT, "points": 0})
        with self.assertRaises(game.QuestError):
            contests.add_item(1, c["id"], {**COUNT, "norm": "abc"})
        v = contests.add_item(1, c["id"], {"title": "Чтение", "kind": "check", "norm": 5, "unit": "стр"})["contest"]
        self.assertIsNone(v["items"][0]["norm"])
        self.assertEqual(v["items"][0]["unit"], "")

    def test_items_limit_free_and_premium(self):
        c = self._contest()
        for i in range(contests.ITEMS_FREE):
            contests.add_item(1, c["id"], {**CHECK, "title": f"Пункт {i}"})
        with self.assertRaises(game.QuestError) as e:
            contests.add_item(1, c["id"], CHECK)
        self.assertEqual(e.exception.code, "contest_items")
        storage.update_user(1, is_premium=1)
        contests.add_item(1, c["id"], {**CHECK, "title": "Шестой"})
        self.assertEqual(contests.view(c["id"], 1)["limits"]["items"], contests.ITEMS_PREMIUM)

    def test_templates_skip_duplicates_and_respect_limit(self):
        c = self._contest()
        res = contests.apply_template(1, c["id"], "sport")
        self.assertEqual(res["added"], 3)
        with self.assertRaises(game.QuestError):
            contests.apply_template(1, c["id"], "sport")
        res = contests.apply_template(1, c["id"], "routine")
        self.assertEqual(res["added"], 2)
        self.assertIn("note", res)
        self.assertEqual(len(res["contest"]["items"]), contests.ITEMS_FREE)
        with self.assertRaises(game.QuestError):
            contests.apply_template(1, c["id"], "nope")

    # ---------- предложения ----------
    def test_proposals_accept_edit_reject(self):
        c = self._contest()
        contests.join(2, c["id"])
        with self.assertRaises(game.QuestError):
            contests.propose(1, c["id"], CHECK)  # создатель добавляет сам
        with self.assertRaises(game.QuestError):
            contests.propose(4, c["id"], CHECK)  # не участник
        res = contests.propose(2, c["id"], {"title": "Планка", "kind": "count", "unit": "мин", "norm": 2})
        self.assertEqual(res["messages"][0][0], 1)
        self.assertEqual(len(res["contest"]["proposals"]), 1)  # свои видно
        self.assertEqual(len(contests.view(c["id"], 1)["proposals"]), 1)
        pid = res["contest"]["proposals"][0]["id"]
        out = contests.decide(1, c["id"], pid, True, {"title": "Планка", "kind": "count", "unit": "мин", "norm": 3})
        self.assertEqual(out["contest"]["items"][0]["norm"], 3)
        self.assertEqual(out["contest"]["items"][0]["proposed_by"], "Маша")
        self.assertIn("с правкой", out["messages"][0][1])
        with self.assertRaises(game.QuestError):
            contests.decide(1, c["id"], pid, False)  # уже решено
        pid2 = contests.propose(2, c["id"], CHECK)["contest"]["proposals"][0]["id"]
        with self.assertRaises(game.QuestError):
            contests.decide(2, c["id"], pid2, True)  # решает только создатель
        out = contests.decide(1, c["id"], pid2, False)
        self.assertIn("не вошло", out["messages"][0][1])
        self.assertEqual(len(out["contest"]["items"]), 1)

    def test_pending_proposals_limit(self):
        c = self._contest()
        contests.join(2, c["id"])
        for i in range(contests.PENDING_PROPOSALS_LIMIT):
            contests.propose(2, c["id"], {**CHECK, "title": f"Идея {i}"})
        with self.assertRaises(game.QuestError):
            contests.propose(2, c["id"], CHECK)

    # ---------- запуск и заморозка ----------
    def test_launch_requires_item_and_two_members(self):
        c = self._contest()
        contests.add_item(1, c["id"], CHECK)
        with self.assertRaises(game.QuestError):
            contests.launch(1, c["id"])  # один участник
        c2 = self._contest()
        contests.join(2, c2["id"])
        with self.assertRaises(game.QuestError):
            contests.launch(1, c2["id"])  # нет пунктов
        contests.join(2, c["id"])
        with self.assertRaises(game.QuestError):
            contests.launch(2, c["id"])  # не создатель
        res = contests.launch(1, c["id"])
        self.assertEqual(res["contest"]["status"], "active")
        self.assertEqual({m[0] for m in res["messages"]}, {1, 2})
        self.assertIn("Правила", res["messages"][0][1])

    def test_launch_asks_about_pending_then_force_rejects(self):
        cid = self._ready()
        contests.propose(2, cid, {**CHECK, "title": "Йога"})
        with self.assertRaises(game.QuestError) as e:
            contests.launch(1, cid)
        self.assertEqual(e.exception.code, "proposals")
        res = contests.launch(1, cid, force=True)
        self.assertEqual(res["contest"]["status"], "active")
        self.assertTrue(any(m[0] == 2 and "не вошло" in m[1] for m in res["messages"]))
        self.assertEqual(contests.view(cid, 1)["proposals"], [])

    def test_frozen_after_launch_and_closed_doors(self):
        cid = self._ready()
        contests.launch(1, cid)
        item = contests.view(cid, 1)["items"][0]
        for call in (lambda: contests.add_item(1, cid, CHECK),
                     lambda: contests.update_item(1, cid, item["id"], CHECK),
                     lambda: contests.delete_item(1, cid, item["id"]),
                     lambda: contests.apply_template(1, cid, "sport"),
                     lambda: contests.propose(2, cid, CHECK),
                     lambda: contests.join(3, cid),
                     lambda: contests.launch(1, cid)):
            with self.assertRaises(game.QuestError):
                call()
        self.assertEqual(contests.view(cid, 1)["members_count"], 2)

    # ---------- отметки и лидеры ----------
    def test_log_and_leaderboard(self):
        cid = self._ready()
        contests.launch(1, cid)
        items = contests.view(cid, 1)["items"]
        chk, cnt = items[0]["id"], items[1]["id"]
        with self.assertRaises(game.QuestError):
            contests.log(4, cid, chk, 1)
        contests.log(1, cid, chk, 1)
        contests.log(1, cid, cnt, 25)
        v = contests.log(2, cid, cnt, 40)["contest"]
        board = {r["id"]: r for r in v["board"]}
        self.assertEqual(board[1]["score"], 35)
        self.assertEqual(board[2]["score"], 40)
        self.assertEqual(v["board"][0]["id"], 2)
        self.assertEqual(board[1]["done_today"], 1)  # 25 < нормы 30
        self.assertEqual(board[2]["done_today"], 1)
        v = contests.log(1, cid, cnt, 30)["contest"]
        me = v["me"]
        self.assertTrue(me["all_today"])
        self.assertEqual(me["score"], 40)
        self.assertEqual([r["place"] for r in v["board"]], [1, 1])  # ничья
        v = contests.log(1, cid, chk, 0)["contest"]
        self.assertEqual(v["me"]["score"], 30)
        with self.assertRaises(game.QuestError):
            contests.log(1, cid, cnt, -1)

    def test_log_only_inside_dates(self):
        cid = self._ready(days=3)
        contests.launch(1, cid)
        item = contests.view(cid, 1)["items"][0]["id"]
        later = date.today() + timedelta(days=5)
        with mock.patch("game.local_today", return_value=later):
            with self.assertRaises(game.QuestError):
                contests.log(1, cid, item, 1)

    def test_leave_lobby_and_give_up(self):
        c = self._contest()
        contests.join(2, c["id"])
        contests.propose(2, c["id"], CHECK)
        res = contests.leave(2, c["id"])
        self.assertEqual(res["messages"][0][0], 1)
        v = contests.view(c["id"], 1)
        self.assertEqual(v["members_count"], 1)
        self.assertEqual(v["proposals"], [])
        cid = self._ready()
        contests.join(3, cid)
        contests.launch(1, cid)
        res = contests.leave(3, cid)
        self.assertEqual({m[0] for m in res["messages"]}, {1, 2})
        v = contests.view(cid, 1)
        self.assertEqual(v["members_count"], 2)
        self.assertTrue(next(r for r in v["board"] if r["id"] == 3)["left"])

    def test_creator_cancels_lobby(self):
        c = self._contest()
        contests.join(2, c["id"])
        res = contests.leave(1, c["id"])
        self.assertEqual(res["messages"][0][0], 2)
        self.assertEqual(contests.view(c["id"], 1)["status"], "cancelled")
        self.assertEqual(contests.list_view(2)["lobby"], [])

    # ---------- планировщик ----------
    def test_finalize_rewards_and_ties(self):
        cid = self._ready(days=3)
        contests.join(3, cid)
        contests.launch(1, cid)
        items = contests.view(cid, 1)["items"]
        contests.log(1, cid, items[1]["id"], 50)
        contests.log(2, cid, items[1]["id"], 50)
        contests.log(3, cid, items[0]["id"], 1)
        self.assertEqual(contests.finalize_due(), [])  # ещё идёт
        later = date.today() + timedelta(days=3)
        with mock.patch("game.local_today", return_value=later):
            msgs = contests.finalize_due()
        by = {m[0]: m[1] for m in msgs}
        self.assertIn("разделённое", by[1])
        self.assertIn("разделённое", by[2])
        self.assertIn("+20 XP", by[3])
        v = contests.view(cid, 1)
        self.assertEqual(v["status"], "done")
        self.assertEqual(sorted(v["winners"]), [1, 2])
        self.assertEqual(len(contests.list_view(1)["finished"]), 1)
        self.assertEqual(storage.get_user(3)["xp"], 20)

    def test_lobby_timeout_reminds_then_cancels(self):
        c = self._contest()
        contests.join(2, c["id"])
        self.assertEqual(contests.lobby_timeouts(), [])
        old = (datetime.utcnow() - timedelta(days=5, hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        contests._set(c["id"], created_at=old)
        msgs = contests.lobby_timeouts()
        self.assertEqual([m[0] for m in msgs], [1])
        self.assertEqual(contests.lobby_timeouts(), [])  # напоминание — один раз
        self.assertEqual(contests.view(c["id"], 1)["lobby_days_left"], 2)
        older = (datetime.utcnow() - timedelta(days=7, hours=1)).strftime("%Y-%m-%d %H:%M:%S")
        contests._set(c["id"], created_at=older)
        msgs = contests.lobby_timeouts()
        self.assertEqual({m[0] for m in msgs}, {1, 2})
        self.assertEqual(contests.view(c["id"], 1)["status"], "cancelled")

    def test_evening_alert_once(self):
        cid = self._ready()
        contests.launch(1, cid)
        items = contests.view(cid, 1)["items"]
        contests.log(2, cid, items[0]["id"], 1)
        contests.log(2, cid, items[1]["id"], 30)
        evening = datetime.combine(date.today(), datetime.min.time()).replace(hour=21)
        with mock.patch("game.local_now", return_value=evening):
            msgs = contests.evening_alerts()
            self.assertEqual([m[0] for m in msgs], [1])
            self.assertIn("2 из 2", msgs[0][1])
            self.assertEqual(contests.evening_alerts(), [])

    def test_delete_user_data(self):
        cid = self._ready()
        other = contests.create(2, {"title": "Машино", "days": 3})["contest"]["id"]
        contests.join(1, other)
        storage.delete_user_data(1)
        with self.assertRaises(game.QuestError):
            contests.view(cid, 2)
        self.assertEqual(contests.view(other, 2)["members_count"], 1)

from datetime import date, timedelta
from unittest import mock

from tests.helpers import TempDBTestCase
import duels
import friends
import game
import habits
import storage


class DuelsTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        for uid, name in ((1, "Аня"), (2, "Маша"), (3, "Чужой")):
            storage.ensure_user(uid)
            storage.update_user(uid, first_name=name)
        friends.add_friend(1, 2)
        self.h1 = habits.create_habit(1, {"title": "Вода", "emoji": "💧", "target": 2})["habit"]["id"]

    def _duel(self, mode="duel", days=7, friend=2):
        return duels.create(1, {"habit_id": self.h1, "mode": mode, "days": days, "friend_id": friend})

    def test_create_invite_and_accept_copies_habit(self):
        res = self._duel()
        d = res["duel"]
        self.assertEqual(d["status"], "pending")
        self.assertEqual(res["messages"][0][0], 2)
        self.assertEqual(res["messages"][0][2][0][1], f"du:a:{d['id']}")
        self.assertEqual(duels.list_view(2)["incoming"][0]["id"], d["id"])
        acc = duels.accept(2, d["id"])
        self.assertEqual(acc["duel"]["status"], "active")
        self.assertEqual(acc["messages"][0][0], 1)
        h2 = [h for h in habits.habits_view(2) if h["title"] == "Вода"]
        self.assertEqual(len(h2), 1)
        self.assertEqual(h2[0]["target"], 2)
        with self.assertRaises(game.QuestError):
            duels.accept(2, d["id"])

    def test_reuses_existing_habit(self):
        mine = habits.create_habit(2, {"title": "вода", "target": 1})["habit"]["id"]
        d = self._duel()["duel"]
        duels.accept(2, d["id"])
        self.assertEqual(duels.list_view(2)["active"][0]["me"]["habit_id"], mine)

    def test_only_friends_and_not_self(self):
        with self.assertRaises(game.QuestError):
            self._duel(friend=3)
        d = self._duel()["duel"]
        with self.assertRaises(game.QuestError):
            duels.accept(1, d["id"])
        with self.assertRaises(game.QuestError):
            duels.accept(3, d["id"])

    def test_link_invite_anyone_can_accept(self):
        d = self._duel(friend=None)
        self.assertEqual(d["messages"], [])
        self.assertEqual(friends.parse_start(f"d_{d['duel']['id']}"), ("d", d["duel"]["id"], 1))
        duels.accept(3, d["duel"]["id"])
        self.assertTrue(friends.are_friends(1, 3))

    def test_progress_pings_and_nudge(self):
        d = self._duel()["duel"]
        duels.accept(2, d["id"])
        habits.log_habit(1, self.h1, delta=1)
        self.assertEqual(duels.on_habit_done(1, self.h1), [])  # цель 2 — ещё не сделано
        habits.log_habit(1, self.h1, delta=1)
        msgs = duels.on_habit_done(1, self.h1)
        self.assertEqual([m[0] for m in msgs], [2])
        self.assertEqual(duels.on_habit_done(1, self.h1), [])  # раз в день
        v = duels.list_view(1)["active"][0]
        self.assertEqual((v["me"]["score"], v["rival"]["score"], v["lead"]), (1, 0, "me"))
        self.assertTrue(v["can_nudge"])
        n = duels.nudge(1, d["id"])
        self.assertEqual(n["messages"][0][0], 2)
        with self.assertRaises(game.QuestError):
            duels.nudge(1, d["id"])
        with self.assertRaises(game.QuestError):  # 1 уже всё сделал
            duels.nudge(2, d["id"])

    def test_team_streak(self):
        d = self._duel(mode="team")["duel"]
        duels.accept(2, d["id"])
        h2 = duels.list_view(2)["active"][0]["me"]["habit_id"]
        habits.log_habit(1, self.h1, count=2)
        habits.log_habit(2, h2, count=2)
        v = duels.list_view(1)["active"][0]
        self.assertEqual((v["team"]["joint"], v["team"]["streak"]), (1, 1))

    def _shift(self, duel_id, days_ago):
        start = date.today() - timedelta(days=days_ago)
        conn = storage.connect()
        conn.execute("UPDATE habit_duels SET start_date = ?, end_date = ? WHERE id = ?",
                     (start.isoformat(), (start + timedelta(days=2)).isoformat(), duel_id))
        conn.commit()
        conn.close()
        return start

    def test_finalize_duel_winner(self):
        d = self._duel(days=3)["duel"]
        duels.accept(2, d["id"])
        start = self._shift(d["id"], 5)
        for i in range(2):
            habits.log_habit(1, self.h1, count=2, day=(start + timedelta(days=i)).isoformat())
        xp1, xp2 = storage.get_user(1)["xp"] or 0, storage.get_user(2)["xp"] or 0
        with mock.patch.object(duels, "_today", lambda uid: date.today()):
            msgs = duels.finalize_due()
        self.assertEqual(sorted(m[0] for m in msgs), [1, 2])
        self.assertEqual(storage.get_user(1)["xp"] or 0, xp1)  # победителю — шапочка, не XP
        self.assertEqual(len(game.owned_items(1) & set(duels.HATS)), 1)
        self.assertIn("Надень", next(m[1] for m in msgs if m[0] == 1))
        self.assertEqual(storage.get_user(2)["xp"], xp2 + duels.XP_LOSE)
        done = duels.list_view(1)["finished"][0]
        self.assertEqual(done["winner"], 1)
        self.assertIn(done["prize"]["id"], game.owned_items(1))  # выигранная шапочка видна на карточке
        self.assertEqual(duels.finalize_due(), [])

    def test_give_up_and_decline(self):
        d = self._duel()["duel"]
        res = duels.decline(2, d["id"])
        self.assertEqual(res["messages"][0][0], 1)
        d2 = self._duel()["duel"]
        duels.accept(2, d2["id"])
        res = duels.give_up(2, d2["id"])
        self.assertEqual(res["messages"][0][0], 1)
        self.assertEqual(duels.list_view(1)["finished"][0]["winner"], 1)
        self.assertIn("🎩", res["messages"][0][1])
        self.assertIsNotNone(duels.list_view(1)["finished"][0]["prize"])

    def test_limits_and_badges(self):
        for _ in range(duels.ACTIVE_LIMIT):
            self._duel()
        with self.assertRaises(game.QuestError):
            self._duel()
        self.assertEqual(duels.habit_badges(1), {})
        d = duels.list_view(1)["outgoing"][0]
        duels.accept(2, d["id"])
        self.assertEqual(duels.habit_badges(1)[str(self.h1)]["with"], "Маша")

    def test_hat_reward_then_xp_when_all_owned(self):
        pool = set(duels.HATS)
        self.assertNotIn("scarf", pool)  # только головные уборы
        got = {duels.winner_reward(1)["id"] for _ in range(len(pool))}
        self.assertEqual(got, pool)
        xp = storage.get_user(1)["xp"] or 0
        self.assertEqual(duels.winner_reward(1)["kind"], "xp")
        self.assertEqual(storage.get_user(1)["xp"], xp + duels.XP_WIN)
        self.assertTrue(all(h in game.ACCESSORY_IDS for h in pool))

    def test_remove_with_cross(self):
        # ожидающий: отменяется и пропадает
        d = self._duel()["duel"]
        res = duels.remove(1, d["id"])
        self.assertEqual(res["messages"], [])
        self.assertEqual(duels.list_view(1)["outgoing"], [])
        self.assertEqual(duels.list_view(2)["incoming"], [])
        # идущий: удаливший сдаётся, у соперника — итог с победой
        d2 = self._duel()["duel"]
        duels.accept(2, d2["id"])
        res = duels.remove(2, d2["id"])
        self.assertEqual(res["messages"][0][0], 1)
        self.assertEqual(duels.list_view(2)["finished"], [])
        mine = duels.list_view(1)["finished"]
        self.assertEqual(mine[0]["winner"], 1)
        # законченный: просто скрывается у того, кто нажал
        duels.remove(1, d2["id"])
        self.assertEqual(duels.list_view(1)["finished"], [])
        with self.assertRaises(game.QuestError):
            duels.remove(3, d2["id"])

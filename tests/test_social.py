from tests.helpers import TempDBTestCase
import game
import social
import storage


class SocialTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        for uid, name in ((1, "Лика"), (2, "Лёша")):
            storage.ensure_user(uid)
            conn = storage.connect()
            conn.execute("UPDATE users SET first_name = ? WHERE user_id = ?", (name, uid))
            conn.execute("INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)", (uid, 3 - uid, "2026-01-01"))
            conn.commit()
            conn.close()

    def test_feed_reactions_and_ping(self):
        q = next(x for x in game.CATALOG.values() if x["mode"] == "solo" and not x.get("pack"))
        r = game.accept_quest(2, q["id"])
        game.complete_quest(2, r["active_id"] if "active_id" in r else game.get_state(2)["active"][0]["active_id"])
        f = social.feed(1)
        kinds = {e["kind"] for e in f["events"]}
        self.assertIn("quest", kinds)
        ev = next(e for e in f["events"] if e["kind"] == "quest")
        res = social.react(1, ev["id"], "🔥")
        self.assertEqual(res["messages"][0][0], 2)
        self.assertEqual(social.feed(1)["events"][0]["mine"], "🔥")
        self.assertEqual(social.react(1, ev["id"], "")["mine"], None)
        p = social.ping(1, 2, "poke")
        self.assertEqual(p["messages"][0][0], 2)
        with self.assertRaises(game.QuestError):
            social.ping(1, 2, "poke")  # раз в день

    def test_pair_quest_flow(self):
        xp_before = [storage.get_user(u)["xp"] or 0 for u in (1, 2)]
        c = social.pair_create(1, 2)
        pid = c["pair"]["id"]
        self.assertEqual(social.pair_list(2)["incoming"][0]["id"], pid)
        social.pair_action(2, pid, "accept")
        social.pair_action(1, pid, "done")
        self.assertEqual(social.pair_list(2)["active"][0]["friend_done"], True)
        r = social.pair_action(2, pid, "done")
        self.assertEqual(r["pair"]["status"], "done")
        xp_after = [storage.get_user(u)["xp"] or 0 for u in (1, 2)]
        self.assertEqual([a - b for a, b in zip(xp_after, xp_before)], [social.PAIR_BONUS_XP] * 2)

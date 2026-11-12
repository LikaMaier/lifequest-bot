import os
import tempfile
import unittest

os.environ.setdefault("BOT_TOKEN", "test")
_tmp = tempfile.mkdtemp()
os.environ["DB_PATH"] = os.path.join(_tmp, "t.db")

import storage  # noqa: E402
import monthly  # noqa: E402
import friends  # noqa: E402


class MonthlyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.init_db()
        for uid, name in ((1, "Лика"), (2, "Олег"), (3, "Ника")):
            storage.ensure_user(uid, name, None)
        friends.add_friend(1, 2)
        monthly.ensure_tables()
        c = storage.connect()
        c.execute("DELETE FROM challenge_log")
        c.execute("DELETE FROM challenge_members")
        c.commit()
        c.close()

    def test_catalog_consistent(self):
        ids = [c["id"] for c in monthly.CATALOG]
        self.assertEqual(len(ids), len(set(ids)))
        for c in monthly.CATALOG:
            self.assertIn(c["kind"], ("sum", "days"))
            self.assertEqual(len(c["unit"]), 3)
            if c["kind"] == "sum":
                self.assertEqual(len(c["steps"]), 3)

    def test_join_log_board(self):
        v = monthly.list_view(1)
        self.assertNotIn("reading", [x["id"] for x in v["mine"]])
        d = monthly.join(1, "reading")
        self.assertTrue(d["joined"])
        monthly.join(2, "reading")
        monthly.join(3, "reading")
        r = monthly.log(1, "reading", 40)
        self.assertEqual(r["xp"], monthly.XP_DAY)
        self.assertEqual(r["my"]["score"], 40)
        r = monthly.log(1, "reading", 10, milestone=True)
        self.assertEqual(r["xp"], 0)  # второй раз за день XP не даём
        self.assertEqual(r["my"]["milestones"], 1)
        monthly.log(2, "reading", 100)
        monthly.log(3, "reading", 5)
        d = monthly.detail(1, "reading")
        self.assertEqual([x["id"] for x in d["top"]], [2, 1, 3])
        self.assertEqual([x["id"] for x in d["friends_board"]], [2, 1])  # 3 — не друг
        self.assertEqual(d["my"]["rank"], 2)
        v = monthly.list_view(1)
        mine = next(x for x in v["mine"] if x["id"] == "reading")
        self.assertTrue(mine["logged_today"])
        self.assertEqual(mine["friends_count"], 1)
        self.assertNotIn("reading", [n["id"] for n in monthly.today_nudges(1)])

    def test_goal_and_days_kind(self):
        monthly.join(1, "early")
        self.assertEqual(monthly.today_nudges(1)[0]["id"], "early")
        monthly.set_goal(1, "early", 1)
        r = monthly.log(1, "early")
        self.assertTrue(r["goal_reached"])
        self.assertEqual(r["xp"], monthly.XP_DAY + monthly.XP_GOAL)
        with self.assertRaises(monthly.ChallengeError):
            monthly.log(1, "early")
        d = monthly.undo(1, "early")
        self.assertEqual(d["my"]["days"], 0)
        monthly.leave(1, "early")
        self.assertFalse(monthly.detail(1, "early")["joined"])

    def test_bad_values(self):
        monthly.join(1, "steps")
        with self.assertRaises(monthly.ChallengeError):
            monthly.log(1, "steps", -5)
        with self.assertRaises(monthly.ChallengeError):
            monthly.log(1, "steps", "abc")
        with self.assertRaises(monthly.ChallengeError):
            monthly.join(1, "nope")


if __name__ == "__main__":
    unittest.main()

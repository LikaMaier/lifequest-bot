import os
import tempfile
import unittest
from datetime import date, timedelta

os.environ.setdefault("BOT_TOKEN", "test")
_tmp = tempfile.mkdtemp()
os.environ["DB_PATH"] = os.path.join(_tmp, "t.db")

import storage  # noqa: E402
import friends  # noqa: E402
import league  # noqa: E402


class LeagueTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.init_db()
        league.ensure_tables()
        for uid, name in ((11, "Лика"), (12, "Олег"), (13, "Ника")):
            storage.ensure_user(uid, name, None)
        friends.add_friend(11, 12)
        friends.add_friend(11, 13)
        today = date.today()
        prev = (today.replace(day=1) - timedelta(days=1))
        c = storage.connect()
        c.execute("DELETE FROM league_results")
        for uid, n in ((11, 2), (12, 5), (13, 1)):
            for i in range(n):
                c.execute("INSERT INTO quest_history (user_id, quest_key, mode, title, status, local_date, completed_at) VALUES (?, 'x', 'solo', 'q', 'done', ?, 'x')",
                          (uid, prev.replace(day=1 + i).isoformat()))
        c.execute("INSERT INTO quest_history (user_id, quest_key, mode, title, status, local_date, completed_at) VALUES (11, 'x', 'solo', 'q', 'done', ?, 'x')",
                  (today.isoformat(),))
        c.commit()
        c.close()

    def test_close_and_view(self):
        v = league.view(11)
        self.assertEqual(v["last"]["rank"], 2)
        self.assertEqual(v["last"]["xp"], league.SEASON_XP[2])
        self.assertEqual(v["last"]["members"], 3)
        # повторный вызов — без повторной награды
        xp_before = storage.get_user(11)["xp"]
        league.view(11)
        self.assertEqual(storage.get_user(11)["xp"], xp_before)
        me = next(r for r in v["rows"] if r["me"])
        self.assertEqual(me["points"], friends.POINTS["quest"])
        self.assertEqual(v["rows"][0]["id"], 11)
        # у Олега — титул чемпиона прошлого сезона (после закрытия его сезона)
        league.view(12)
        v = league.view(11)
        oleg = next(r for r in v["rows"] if r["id"] == 12)
        self.assertTrue(oleg["champion"])
        self.assertEqual(oleg["wins"], 1)

    def test_single_player_no_reward(self):
        storage.ensure_user(99, "Один", None)
        r = league.close_previous(99, date.today())
        self.assertEqual(r["xp"], 0)
        self.assertEqual(r["members"], 1)


if __name__ == "__main__":
    unittest.main()

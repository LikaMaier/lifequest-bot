import random
import unittest
from datetime import date, timedelta

from tests.helpers import TempDBTestCase
import game
import storage
from quests_database import CATALOG


class ChooseQuestTest(unittest.TestCase):
    POOL = [{"id": f"q{i}"} for i in range(5)]

    def test_skips_done_active_recent(self):
        rng = random.Random(1)
        for _ in range(50):
            q = game.choose_quest(self.POOL, done={"q0"}, active={"q1"}, recent={"q2", "q3"}, rng=rng)
            self.assertEqual(q["id"], "q4")

    def test_relaxes_when_everything_seen(self):
        # всё уже выпадало недавно — повторяем недавнее, но не выполненное/активное
        q = game.choose_quest(self.POOL, done={"q0"}, active={"q1"}, recent={"q2", "q3", "q4"})
        self.assertIn(q["id"], {"q2", "q3", "q4"})
        # всё выполнено — лишь бы не активное
        q = game.choose_quest(self.POOL, done={"q0", "q2", "q3", "q4"}, active={"q1"}, recent=set())
        self.assertNotEqual(q["id"], "q1")


class RandomQuestDBTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")

    def test_no_repeats_across_rolls(self):
        rng = random.Random(7)
        pool = [q for q in CATALOG.values() if q["mode"] == "company"]
        seen = [game.random_quest(1, "company", rng=rng)["id"] for _ in range(game.RECENT_OFFERS)]
        self.assertEqual(len(seen), len(set(seen)), "задания не должны повторяться в пределах окна")
        self.assertTrue(all(CATALOG[k]["mode"] == "company" for k in seen))
        self.assertGreater(len(pool), game.RECENT_OFFERS)

    def test_done_quest_not_offered_again(self):
        rng = random.Random(3)
        pool = [q["id"] for q in CATALOG.values() if q["mode"] == "solo" and q["sphere"] == "Смелость"]
        first = pool[0]
        res = game.accept_quest(1, first)
        game.complete_quest(1, res["active_id"])
        offered = {game.random_quest(1, "solo", "Смелость", rng=rng)["id"] for _ in range(len(pool) - 1)}
        self.assertNotIn(first, offered)

    def test_sphere_filter_and_daily_limit(self):
        q = game.random_quest(1, "solo", "Энергия", rng=random.Random(1))
        self.assertEqual(q["sphere"], "Энергия")
        conn = storage.connect()
        today = game.local_today(storage.get_user(1)).isoformat()
        conn.executemany("INSERT INTO quest_offers (user_id, quest_key, mode, local_date) VALUES (1, 'x', 'solo', ?)",
                         [(today,)] * game.DAILY_ROLL_LIMIT)
        conn.commit()
        conn.close()
        with self.assertRaises(game.QuestError):
            game.random_quest(1, "solo")

    def test_bad_mode(self):
        with self.assertRaises(game.QuestError):
            game.random_quest(1, "solo-ish")


class StreakTest(unittest.TestCase):
    D = date(2026, 10, 7)  # среда

    def iso(self, days_ago):
        return (self.D - timedelta(days=days_ago)).isoformat()

    def test_first_and_same_day(self):
        self.assertEqual(game.advance_streak(0, 0, None, None, self.D)[:2], (1, 1))
        self.assertEqual(game.advance_streak(3, 5, self.iso(0), None, self.D)[:2], (3, 5))

    def test_consecutive(self):
        cur, best, _fw, used = game.advance_streak(4, 4, self.iso(1), None, self.D)
        self.assertEqual((cur, best, used), (5, 5, False))

    def test_gap_resets(self):
        cur, best, _fw, _used = game.advance_streak(6, 6, self.iso(3), None, self.D)
        self.assertEqual((cur, best), (1, 6))

    def test_freeze_once_per_week(self):
        cur, _best, fw, used = game.advance_streak(4, 4, self.iso(2), None, self.D)
        self.assertEqual((cur, used), (5, True))
        self.assertEqual(fw, storage.week_key_for(self.D))
        # вторая заморозка на той же неделе не срабатывает
        later = self.D + timedelta(days=2)
        cur2, _b, _fw2, used2 = game.advance_streak(5, 5, self.D.isoformat(), fw, later)
        self.assertEqual((cur2, used2), (1, False))

    def test_view_statuses(self):
        self.assertEqual(game.streak_view(3, 3, self.iso(0), None, self.D)["status"], "done")
        self.assertEqual(game.streak_view(3, 3, self.iso(1), None, self.D)["status"], "at_risk")
        self.assertEqual(game.streak_view(3, 3, self.iso(2), None, self.D)["status"], "freeze")
        lost = game.streak_view(3, 3, self.iso(5), None, self.D)
        self.assertEqual((lost["status"], lost["current"], lost["lost_value"]), ("lost", 0, 3))


class XpAndLevelsTest(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(game.level_for_xp(0), 1)
        self.assertEqual(game.level_for_xp(59), 1)
        self.assertEqual(game.level_for_xp(60), 2)
        self.assertEqual(game.level_info(2700)["level"], 10)
        self.assertEqual(game.level_for_xp(2700 + game.LEVEL_STEP_AFTER_MAX), 11)

    def test_quest_xp_bonuses(self):
        parts = dict(game.quest_xp("solo", "medium", "Смелость", same_day=True, daily=True, streak=4, first_today=True))
        self.assertEqual(parts["Задание"], 20)
        self.assertEqual(parts["Смелость"], game.BRAVE_BONUS)
        self.assertEqual(parts["Задание дня"], game.DAILY_BONUS)
        self.assertEqual(parts["Серия 4 дн."], 8)
        no_streak = dict(game.quest_xp("company", None, None, False, False, streak=4, first_today=False))
        self.assertEqual(no_streak, {"Задание": 25})

    def test_daily_quest_is_deterministic(self):
        d = date(2026, 10, 9)
        self.assertEqual(game.daily_quest_id(d), game.daily_quest_id(d))
        self.assertEqual(CATALOG[game.daily_quest_id(d)]["mode"], "solo")

    def test_board_lines(self):
        board = storage.normalize_board({"cells": ["x"] * 9, "done": [True, True, True, False, True, False, False, False, True]})
        prog = game.board_progress(board)
        self.assertEqual(prog["lines"], [0, 6])  # верхний ряд и диагональ
        self.assertFalse(prog["full"])


class FlowTest(TempDBTestCase):
    def test_accept_complete_awards_once(self):
        storage.ensure_user(5)
        res = game.accept_quest(5, "no_list", "easy")
        self.assertFalse(res["already"])
        self.assertTrue(game.accept_quest(5, "no_list")["already"])
        done = game.complete_quest(5, res["active_id"])
        self.assertEqual(done["xp"], 10 + game.SAME_DAY_BONUS)
        self.assertIn("first_quest", [a["code"] for a in done["new_achievements"]])
        self.assertIsNone(game.complete_quest(5, res["active_id"]))
        self.assertEqual(storage.get_user(5)["xp"], done["xp"])
        # бот видит выполненное в старом формате (/completed, итог месяца)
        self.assertEqual(len(storage.get_recent_completed_texts(5)), 1)
        self.assertIn("Список «не буду»", storage.get_recent_completed_texts(5)[0])

    def test_board_awards_once_per_week(self):
        storage.ensure_user(6)
        first = game.save_board(6, {"cells": ["a"] * 9, "done": [True] * 9})
        self.assertTrue(first["new_full"])
        self.assertEqual(first["xp"], 9 * game.BOARD_CELL_XP + 8 * game.BOARD_LINE_XP + game.BOARD_FULL_XP)
        again = game.save_board(6, {"cells": ["a"] * 9, "done": [True] * 9})
        self.assertEqual(again["xp"], 0)

    def test_legacy_backfill(self):
        conn = storage.connect()
        conn.execute("DELETE FROM meta")
        conn.execute("INSERT INTO completed_tasks (user_id, task_cell, task_text) VALUES (9, 'two_truths', 'x')")
        conn.commit()
        conn.close()
        storage.init_db()
        stats = game.get_stats(9, "all")
        self.assertEqual(stats["records"]["total"], 1)
        self.assertEqual(stats["history"][0]["mode"], "company")


if __name__ == "__main__":
    unittest.main()


class TitleSyncTest(TempDBTestCase):
    def test_renamed_quest_updates_history_and_active(self):
        storage.ensure_user(4)
        conn = storage.connect()
        conn.execute("INSERT INTO active_quests (user_id, task_key, task_text, tier) VALUES (4, 'evening_tidy', '🧹 <b>5 минут вечером</b>\\nВесь день убирай', 'medium')")
        conn.execute("INSERT INTO quest_history (user_id, quest_key, title, status) VALUES (4, 'evening_tidy', '5 минут вечером', 'done')")
        conn.commit()
        conn.close()
        storage.init_db()
        conn = storage.connect()
        text = conn.execute("SELECT task_text FROM active_quests WHERE user_id = 4").fetchone()[0]
        title = conn.execute("SELECT title FROM quest_history WHERE user_id = 4").fetchone()[0]
        conn.close()
        self.assertIn("Чистота снаружи — чистота в голове", text)
        self.assertEqual(title, "Чистота снаружи — чистота в голове")

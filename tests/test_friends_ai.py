import os
import tempfile
from unittest import mock

from tests.helpers import TempDBTestCase
import aiquest
import friends
import game
import storage

os.environ.setdefault("BOT_TOKEN", "123456789:TEST-TOKEN")
_boot = tempfile.mkdtemp()
_old = storage.DB_PATH
storage.DB_PATH = os.path.join(_boot, "boot.db")
import lifequest_bot  # noqa: E402
storage.DB_PATH = _old


class FriendsTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "a", "Аня")
        storage.ensure_user(2, "b", "Боря")

    def test_parse_start(self):
        self.assertEqual(friends.parse_start("ref_42"), ("ref", None, 42))
        self.assertEqual(friends.parse_start("q_no_list_42"), ("q", "no_list", 42))
        self.assertIsNone(friends.parse_start("q_unknown_quest_42"))
        self.assertIsNone(friends.parse_start("hello"))

    def test_join_gifts_once_and_list(self):
        res = friends.handle_join(2, 1, is_new=True)
        self.assertTrue(res["gift"])
        self.assertEqual(storage.get_user(1)["freeze_tokens"], 1)
        self.assertEqual(storage.get_user(2)["freeze_tokens"], 1)
        again = friends.handle_join(2, 1, is_new=True)
        self.assertFalse(again["gift"])  # повторно не дарим
        self.assertEqual([f["id"] for f in friends.list_view(1)["friends"]], [2])
        self.assertEqual([f["id"] for f in friends.list_view(2)["friends"]], [1])
        friends.remove(1, 2)
        self.assertEqual(friends.list_view(2)["friends"], [])

    def test_self_invite_ignored(self):
        self.assertFalse(friends.handle_join(1, 1, is_new=True)["ok"])

    def test_old_user_becomes_friend_without_gift(self):
        res = friends.handle_join(2, 1, is_new=False)
        self.assertTrue(res["added"])
        self.assertFalse(res["gift"])


class StartDeepLinkTest(TempDBTestCase, __import__("unittest").IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(1, "a", "Аня")

    async def test_quest_invite_accepts_quest_for_new_user(self):
        msg = mock.MagicMock()
        msg.text = "/start q_no_list_1"
        msg.from_user.id, msg.from_user.username, msg.from_user.first_name = 5, "n", "Новичок"
        msg.answer = mock.AsyncMock()
        with mock.patch.object(lifequest_bot.ops, "safe_send", new=mock.AsyncMock()) as sent:
            await lifequest_bot.cmd_start(msg)
        self.assertEqual([q[1] for q in storage.get_active_quests(5)], ["no_list"])
        self.assertTrue(friends.are_friends(1, 5))
        self.assertIn("принимает твой вызов", sent.call_args.args[1])


class AiQuestTest(TempDBTestCase, __import__("unittest").IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(1, "a", "Аня")

    async def test_fallback_without_key(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            res = await aiquest.generate(1, "brave", "60", "city")
        self.assertFalse(res["ai"])
        self.assertIn(res["quest"]["sphere"], ("Смелость", "Приключения"))

    async def test_generated_quest_accept_complete_and_limit(self):
        fake = {"emoji": "🦆", "title": "Утиный парад", "text": "Найди в городе пять уток и придумай каждой имя и биографию.",
                "sphere": "Приключения"}
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": "x"}), \
                mock.patch.object(aiquest, "_ask_groq", new=mock.AsyncMock(return_value=fake)):
            res = await aiquest.generate(1, "bored", "60", "city")
            self.assertTrue(res["ai"])
            qid = res["quest"]["id"]
            acc = game.accept_quest(1, qid)
            active = game.active_quests_view(1)
            self.assertEqual(active[0]["title"], "Утиный парад")
            out = game.complete_quest(1, acc["active_id"])
            self.assertGreater(out["xp"], 0)
            for _ in range(aiquest.DAILY_LIMIT - 1):
                await aiquest.generate(1, "bored", "60", "city")
            with self.assertRaises(game.QuestError) as err:
                await aiquest.generate(1, "bored", "60", "city")
            self.assertEqual(err.exception.code, "ai_limit")
        storage.ensure_user(2)
        with self.assertRaises(game.QuestError):
            game.accept_quest(2, qid)  # чужой ИИ-квест не принять

    async def test_bank_matches_mood_place_and_time(self):
        import mood_bank
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            for (mood, place), by_time in mood_bank.BANK.items():
                for time, item in by_time.items():
                    res = await aiquest.generate(1, mood, time, place)
                    self.assertEqual(res["quest"]["title"], item[1])
            with self.assertRaises(game.QuestError):
                await aiquest.generate(1, "bored", "60", "work")  # «на работе» больше нет
        acc = game.accept_quest(1, res["quest"]["id"])  # банк-квест принимается как обычный
        self.assertFalse(acc["already"])
        self.assertEqual(aiquest._today_count(1, game.local_today(storage.get_user(1)).isoformat()), 0)

    async def test_groq_error_falls_back(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": "x"}), \
                mock.patch.object(aiquest, "_ask_groq", new=mock.AsyncMock(side_effect=RuntimeError("down"))):
            res = await aiquest.generate(1, "cozy", "15", "home")
        self.assertFalse(res["ai"])


class RecapTest(TempDBTestCase):
    def test_recap_counts(self):
        storage.ensure_user(1)
        today = game.local_today(storage.get_user(1))
        conn = storage.connect()
        conn.execute("INSERT INTO quest_history (user_id, quest_key, status, local_date, sphere, title) VALUES (1, 'x', 'done', ?, 'Смелость', 'Т')",
                     (today.isoformat(),))
        conn.commit()
        conn.close()
        r = game.recap(1, "month")
        self.assertEqual((r["quests"], r["active_days"], r["top_sphere"]), (1, 1, "Смелость"))
        self.assertEqual(game.recap(1, "year")["quests"], 1)

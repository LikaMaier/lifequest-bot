import gzip
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from aiogram.exceptions import TelegramForbiddenError
from aiogram.methods import SendMessage

from tests.helpers import TempDBTestCase
import ops
import storage


class FakeBot:
    def __init__(self, fail_for=()):
        self.sent, self.docs, self.fail_for = [], [], set(fail_for)

    async def send_message(self, chat_id, text, **kw):
        if chat_id in self.fail_for:
            raise TelegramForbiddenError(method=SendMessage(chat_id=chat_id, text=text),
                                         message="Forbidden: bot was blocked by the user")
        self.sent.append((chat_id, text))
        return True

    async def send_document(self, chat_id, document, caption=None):
        with open(document.path, "rb") as f:
            self.docs.append((chat_id, f.read(), caption))


class OpsTest(TempDBTestCase, unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        TempDBTestCase.setUp(self)
        storage.ensure_user(1)
        storage.ensure_user(2)
        self.bot = FakeBot(fail_for={2})
        ops.setup(self.bot, 999)
        ops._last_alert.clear()

    def tearDown(self):
        ops.setup(None, 0)
        TempDBTestCase.tearDown(self)

    async def test_blocked_user_marked_and_skipped(self):
        self.assertIsNone(await ops.safe_send(2, "hi"))
        self.assertTrue(storage.is_blocked(2))
        self.bot.fail_for.clear()
        self.assertIsNone(await ops.safe_send(2, "hi again"))  # больше не пишем
        self.assertEqual(self.bot.sent, [])
        self.assertTrue(await ops.safe_send(1, "hi"))

    async def test_activity_unblocks(self):
        storage.set_blocked(2)
        storage.mark_seen(2)
        self.assertFalse(storage.is_blocked(2))
        self.assertTrue(storage.get_user(2)["last_seen_at"])

    async def test_alert_rate_limited(self):
        err = ValueError("boom")
        await ops.alert("job", err)
        await ops.alert("job", err)
        self.assertEqual(len(self.bot.sent), 1)
        self.assertEqual(self.bot.sent[0][0], 999)
        self.assertIn("boom", self.bot.sent[0][1])

    async def test_backup_is_valid_db(self):
        self.assertTrue(await ops.send_backup())
        chat_id, data, caption = self.bot.docs[0]
        self.assertEqual(chat_id, 999)
        self.assertIn("Пользователей: 2", caption)
        path = os.path.join(tempfile.mkdtemp(), "restored.db")
        with open(path, "wb") as f:
            f.write(gzip.decompress(data))
        conn = sqlite3.connect(path)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0], 2)
        conn.close()

    async def test_backup_without_admin_is_skipped(self):
        ops.setup(self.bot, 0)
        self.assertFalse(await ops.send_backup())


if __name__ == "__main__":
    unittest.main()

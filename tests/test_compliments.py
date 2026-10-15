import asyncio
import os
from unittest import mock

from tests.helpers import TempDBTestCase
import compliments
import storage


class ComplimentsTest(TempDBTestCase):
    def test_no_repeats_and_heart(self):
        texts = [compliments.for_day(d) for d in range(len(compliments.COMPLIMENTS))]
        self.assertEqual(len(set(texts)), len(texts))
        self.assertTrue(all(any(t.endswith(h) for h in compliments.HEARTS) for t in texts))

    def test_only_owner_once_a_day(self):
        os.environ.setdefault("BOT_TOKEN", "123456:TEST")
        import lifequest_bot as lb
        storage.ensure_user(42)
        storage.ensure_user(7)
        sent = []

        async def fake_send(uid, text, **kw):
            sent.append(uid)
        hour = lb.game.local_now(storage.get_user(42)).hour
        with mock.patch.object(lb, "ADMIN_ID", 42), mock.patch.object(lb.ops, "safe_send", fake_send), \
                mock.patch.dict(os.environ, {"COMPLIMENT_HOUR": str(hour)}):
            asyncio.run(lb.send_owner_compliment())
            asyncio.run(lb.send_owner_compliment())
        self.assertEqual(sent, [42])

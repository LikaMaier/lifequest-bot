import os
import tempfile
import unittest
from datetime import datetime, timedelta

os.environ.setdefault("BOT_TOKEN", "test")
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")

import storage  # noqa: E402
import billing  # noqa: E402
import game  # noqa: E402


class ForeverTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.init_db()
        storage.ensure_user(51, "Лика", None)

    def test_price_and_apply(self):
        real = billing._now
        try:
            # после окна запуска и больше месяца с регистрации — полная цена
            billing._now = lambda: datetime(2027, 3, 1)
            self.assertEqual(billing.price(51, "premium_forever", "RUB"), 300000)
            self.assertEqual(billing.price(51, "premium_forever", "XTR"), 2250)
            # новичок: первый месяц — 1000 ₽
            c = storage.connect()
            c.execute("UPDATE users SET created_at = '2027-02-20 10:00:00' WHERE user_id = 51")
            c.commit()
            c.close()
            self.assertEqual(billing.price(51, "premium_forever", "RUB"), 100000)
            self.assertEqual(billing.price(51, "premium_forever", "XTR"), 750)
            billing._now = lambda: datetime(2027, 3, 25)
            self.assertEqual(billing.price(51, "premium_forever", "RUB"), 300000)
        finally:
            billing._now = real
        payload = billing.make_payload(51, "premium_forever", "RUB")
        r = billing.apply_payment(51, payload, "ch-1", billing.price(51, "premium_forever", "RUB"), "RUB")
        self.assertTrue(r["forever"])
        self.assertTrue(game.premium_forever(storage.get_user(51)))
        self.assertTrue(billing.apply_payment(51, payload, "ch-1", 1, "RUB")["duplicate"])
        with self.assertRaises(game.QuestError):
            billing.check_purchase(51, "premium_forever")
        billing.mark_refunded("ch-1")
        self.assertFalse(game.premium_forever(storage.get_user(51)))


if __name__ == "__main__":
    unittest.main()

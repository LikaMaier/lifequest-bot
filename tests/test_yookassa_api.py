import asyncio
from unittest import mock

from tests.helpers import TempDBTestCase
import billing
import game
import storage
import yookassa_api


class FakeApi:
    def __init__(self):
        self.payments = {}
        self.calls = []

    async def __call__(self, method, url, body=None, idempotence_key=None):
        self.calls.append((method, url, body))
        if method == "POST":
            pid = f"p{len(self.payments) + 1}"
            self.payments[pid] = {"id": pid, "status": "pending", "paid": False, "amount": body["amount"]}
            return {**self.payments[pid], "confirmation": {"confirmation_url": f"https://yoomoney.ru/checkout/{pid}"}}
        return self.payments[url.rsplit("/", 1)[1]]

    def pay(self, pid, value=None):
        p = self.payments[pid]
        p.update(status="succeeded", paid=True)
        if value:
            p["amount"] = {"value": value, "currency": "RUB"}


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class YookassaApiTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")
        self.api = FakeApi()
        self.patches = [mock.patch.object(yookassa_api, "SHOP_ID", "1506232"),
                        mock.patch.object(yookassa_api, "SECRET_KEY", "test_secret"),
                        mock.patch.object(yookassa_api, "_request", self.api)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        super().tearDown()

    def test_create_pay_and_apply_once(self):
        res = run(yookassa_api.create(1, "premium_month", "https://t.me/bot"))
        self.assertEqual(res["amount"], 9900)  # первый месяц со скидкой
        body = self.api.calls[0][2]
        self.assertEqual(body["amount"], {"value": "99.00", "currency": "RUB"})
        self.assertTrue(body["capture"])
        self.assertIsNone(run(yookassa_api.sync(res["id"])))  # ещё не оплачен
        self.assertFalse(game.is_premium(storage.get_user(1)))
        self.api.pay(res["id"])
        self.assertIsNone(run(yookassa_api.sync(res["id"], user_id=2)))  # чужой платёж не проверить
        done = run(yookassa_api.sync(res["id"], user_id=1))
        self.assertFalse(done["duplicate"])
        self.assertEqual(done["user_id"], 1)
        self.assertTrue(game.is_premium(storage.get_user(1)))
        self.assertTrue(run(yookassa_api.sync(res["id"]))["duplicate"])  # повторное уведомление ничего не удвоит
        self.assertEqual(billing.stats()["rub"], 99)

    def test_amount_mismatch_is_rejected(self):
        res = run(yookassa_api.create(1, "premium_year", "https://t.me/bot"))
        self.api.pay(res["id"], value="1.00")
        with self.assertRaises(game.QuestError):
            run(yookassa_api.sync(res["id"]))
        self.assertFalse(game.is_premium(storage.get_user(1)))

    def test_disabled_and_bad_product(self):
        with mock.patch.object(yookassa_api, "SECRET_KEY", ""):
            with self.assertRaises(game.QuestError) as err:
                run(yookassa_api.create(1, "premium_month", "x"))
            self.assertEqual(err.exception.code, "payments_off")
        with self.assertRaises(game.QuestError):
            run(yookassa_api.create(1, "freeze", "x"))
        self.assertIsNone(run(yookassa_api.sync("unknown")))


class SyncPendingTest(YookassaApiTest):
    def test_sync_pending_applies_paid_once(self):
        a = run(yookassa_api.create(1, "premium_month", "x"))
        storage.ensure_user(2, "v", "V")
        b = run(yookassa_api.create(2, "premium_month", "x"))
        self.assertEqual(run(yookassa_api.sync_pending()), [])  # никто ещё не заплатил
        self.api.pay(a["id"])
        done = run(yookassa_api.sync_pending())
        self.assertEqual([r["user_id"] for r in done], [1])
        self.assertEqual(run(yookassa_api.sync_pending()), [])  # второй раз — ничего
        self.assertEqual(yookassa_api.pending_ids(), [b["id"]])
        self.assertEqual(yookassa_api.pending_ids(1), [])

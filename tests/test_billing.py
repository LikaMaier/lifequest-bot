from datetime import date, datetime, timedelta
from unittest import mock

from tests.helpers import TempDBTestCase
import billing
import game
import storage


def _done(user_id, n):
    conn = storage.connect()
    conn.executemany("INSERT INTO quest_history (user_id, quest_key, status) VALUES (?, 'x', 'done')",
                     [(user_id,)] * n)
    conn.commit()
    conn.close()


class PremiumTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")

    def test_trial_after_three_quests_once(self):
        with self.assertRaises(game.QuestError):
            billing.start_trial(1)
        _done(1, 3)
        self.assertTrue(billing.trial_available(storage.get_user(1)))
        billing.start_trial(1)
        user = storage.get_user(1)
        self.assertTrue(game.is_premium(user))
        self.assertFalse(billing.trial_available(user))
        with self.assertRaises(game.QuestError):
            billing.start_trial(1)

    def test_expired_premium_hides_premium_items(self):
        storage.update_user(1, premium_until="2000-01-01 00:00:00", accessory="wizard", theme="space")
        user = storage.get_user(1)
        self.assertFalse(game.is_premium(user))
        self.assertIsNone(game.visible_accessory(user))
        self.assertEqual(game.visible_theme(user), "classic")
        with self.assertRaises(game.QuestError) as err:
            game.equip(1, "wizard")
        self.assertEqual(err.exception.code, "premium_item")
        billing.grant(1, 30)
        game.equip(1, "wizard")
        game.update_settings(1, {"theme": "space"})
        self.assertEqual(game.visible_theme(storage.get_user(1)), "space")

    def test_premium_gets_second_weekly_freeze(self):
        today = date(2026, 10, 14)  # среда
        last = (today - timedelta(days=3)).isoformat()  # пропущено 2 дня
        storage.update_user(1, streak_current=10, streak_best=10, streak_last_date=last)
        self.assertEqual(game.user_streak(storage.get_user(1), today)["status"], "lost")
        billing.grant(1, 30)
        self.assertEqual(game.user_streak(storage.get_user(1), today)["status"], "freeze")
        with mock.patch.object(game, "local_now", return_value=datetime(2026, 10, 14, 12)):
            out = game.habit_streak_tick(1, today)
        self.assertEqual(out["streak"], 11)
        self.assertTrue(out["used_freeze"])
        user = storage.get_user(1)
        self.assertEqual(user["freeze_week_count"], 2)
        self.assertEqual(game.weekly_freeze_left(user, today), 0)

    def test_premium_user_ids_env(self):
        self.assertFalse(game.is_premium(storage.get_user(1)))
        with mock.patch.object(game, "PREMIUM_USER_IDS", {1}):
            user = storage.get_user(1)
            self.assertTrue(game.is_premium(user))
            self.assertTrue(billing.premium_view(user)["forever"])
            self.assertFalse(billing.trial_available(user))

    def test_premium_unlocks_all_mascots(self):
        with self.assertRaises(game.QuestError):
            game.update_settings(1, {"mascot": "pig"})  # свинка — с 7 уровня
        self.assertFalse(all(m["unlocked"] for m in game.get_state(1)["unlocks"]["mascots"]))
        with mock.patch.object(game, "PREMIUM_USER_IDS", {1}):
            game.update_settings(1, {"mascot": "pig"})
            self.assertTrue(all(m["unlocked"] for m in game.get_state(1)["unlocks"]["mascots"]))

    def test_payments_disabled_blocks_invoice(self):
        with mock.patch.object(game, "PAYMENTS_ENABLED", False):
            with self.assertRaises(game.QuestError) as err:
                billing.invoice_params(1, "premium_month")
            self.assertEqual(err.exception.code, "payments_off")


class PaymentsTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")
        self.p = mock.patch.object(game, "PAYMENTS_ENABLED", True)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        super().tearDown()

    def test_first_purchase_discount_and_idempotent_apply(self):
        params = billing.invoice_params(1, "premium_month")
        self.assertEqual(params["stars"], 75)
        product = billing.validate_checkout(1, params["payload"], 75, "XTR")
        self.assertEqual(product, "premium_month")
        res = billing.apply_payment(1, params["payload"], "ch1", 75)
        self.assertFalse(res["duplicate"])
        until = storage.get_user(1)["premium_until"]
        self.assertTrue(game.is_premium(storage.get_user(1)))
        self.assertTrue(billing.apply_payment(1, params["payload"], "ch1", 75)["duplicate"])
        self.assertEqual(storage.get_user(1)["premium_until"], until)
        # вторая покупка — полная цена и продление от текущего срока
        self.assertEqual(billing.price(1, "premium_month"), 149)
        billing.apply_payment(1, billing.make_payload(1, "premium_month"), "ch2", 149)
        new_until = game.premium_until(storage.get_user(1))
        self.assertEqual((new_until - game.premium_until({"premium_until": until})).days, 30)

    def test_checkout_rejects_tampering(self):
        payload = billing.make_payload(1, "freeze")
        for uid, total, cur in ((2, 25, "XTR"), (1, 1, "XTR"), (1, 25, "USD")):
            with self.assertRaises(game.QuestError):
                billing.validate_checkout(uid, payload, total, cur)
        storage.update_user(1, freeze_tokens=game.FREEZE_MAX)
        with self.assertRaises(game.QuestError):
            billing.validate_checkout(1, payload, 25, "XTR")

    def test_streak_restore(self):
        user = storage.get_user(1)
        today = game.local_today(user)
        storage.update_user(1, streak_current=12, streak_best=12,
                            streak_last_date=(today - timedelta(days=3)).isoformat(),
                            freeze_week=game.week_key(today), freeze_week_count=1)
        self.assertEqual(billing.restore_offer(storage.get_user(1)), 12)
        billing.apply_payment(1, billing.make_payload(1, "streak_restore"), "r1", 49)
        s = game.user_streak(storage.get_user(1), today)
        self.assertEqual((s["status"], s["current"]), ("at_risk", 12))
        with self.assertRaises(game.QuestError):
            billing.check_purchase(1, "streak_restore")

    def test_refund_takes_premium_back(self):
        billing.apply_payment(1, billing.make_payload(1, "premium_year"), "y1", 990)
        billing.mark_refunded("y1")
        self.assertFalse(game.is_premium(storage.get_user(1)))
        with self.assertRaises(game.QuestError):
            billing.mark_refunded("y1")
        self.assertEqual(billing.stats()["stars"], 0)

    def test_premium_notices_once(self):
        soon = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
        storage.update_user(1, premium_until=soon)
        found = billing.users_for_premium_notice()
        self.assertEqual([(u, k) for u, k, _ in found], [(1, "soon")])
        billing.mark_notice(1, "soon", soon)
        self.assertEqual(billing.users_for_premium_notice(), [])

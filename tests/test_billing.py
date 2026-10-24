from datetime import date, datetime, timedelta
from unittest import mock

from tests.helpers import TempDBTestCase
import json
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

    def test_trial_after_three_habit_days(self):
        import habits
        hb = habits.create_habit(1, {"title": "Вода"})["habit"]
        today = game.local_today(storage.get_user(1))
        for i in (2, 1):
            habits.log_habit(1, hb["id"], count=1, day=(today - timedelta(days=i)).isoformat())
        self.assertFalse(billing.trial_available(storage.get_user(1)))
        habits.log_habit(1, hb["id"], count=1)
        self.assertTrue(billing.trial_available(storage.get_user(1)))
        billing.start_trial(1)
        self.assertTrue(game.is_premium(storage.get_user(1)))

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
        storage.update_user(1, premium_until="2000-01-01 00:00:00", accessory="wizard", theme="matrix")
        user = storage.get_user(1)
        self.assertFalse(game.is_premium(user))
        self.assertIsNone(game.visible_accessory(user))
        self.assertEqual(game.visible_theme(user), "classic")
        with self.assertRaises(game.QuestError) as err:
            game.equip(1, "wizard")
        self.assertEqual(err.exception.code, "premium_item")
        billing.grant(1, 30)
        game.equip(1, "wizard")
        game.update_settings(1, {"theme": "matrix"})
        self.assertEqual(game.visible_theme(storage.get_user(1)), "matrix")

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


class RublePaymentsTest(TempDBTestCase):
    """ЮKassa (рубли) для месяца Premium и звёзды — как альтернатива."""

    def setUp(self):
        super().setUp()
        storage.ensure_user(1, "u", "U")
        self.patches = [mock.patch.object(billing, "YOOKASSA_TOKEN", "test:token"),
                        mock.patch.object(game, "PAYMENTS_ENABLED", True)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        super().tearDown()

    def test_month_offers_rubles_first_and_stars_as_alternative(self):
        view = billing.premium_view(storage.get_user(1))
        self.assertEqual([o["text"] for o in view["options"]["premium_month"]], ["199 ₽", "75⭐"])
        self.assertEqual([o["currency"] for o in view["options"]["freeze"]], ["XTR"])
        self.assertTrue(view["payments"])

    def test_rub_invoice_and_payment(self):
        params = billing.invoice_params(1, "premium_month")
        self.assertEqual((params["currency"], params["amount"], params["provider_token"]), ("RUB", 19900, "test:token"))
        self.assertEqual(params["extra"], {})
        self.assertEqual(billing.validate_checkout(1, params["payload"], 19900, "RUB"), "premium_month")
        with self.assertRaises(game.QuestError):  # та же сумма, но другой валютой
            billing.validate_checkout(1, params["payload"], 19900, "XTR")
        billing.apply_payment(1, params["payload"], "rub1", 19900, "RUB")
        self.assertTrue(game.is_premium(storage.get_user(1)))
        st = billing.stats()
        self.assertEqual((st["rub"], st["stars"]), (199, 0))
        row = billing.mark_refunded("rub1")
        self.assertEqual(row["currency"], "RUB")
        self.assertFalse(game.is_premium(storage.get_user(1)))

    def test_stars_alternative_invoice(self):
        params = billing.invoice_params(1, "premium_month", "XTR")
        self.assertEqual((params["currency"], params["amount"], params["provider_token"]), ("XTR", 75, ""))
        self.assertEqual(billing.validate_checkout(1, params["payload"], 75, "XTR"), "premium_month")
        with self.assertRaises(game.QuestError):  # рублями год не продаётся
            billing.invoice_params(1, "premium_year", "RUB")

    def test_receipt_data_when_enabled(self):
        with mock.patch.object(billing, "YOOKASSA_RECEIPT", True):
            extra = billing.invoice_params(1, "premium_month")["extra"]
        self.assertTrue(extra["need_email"] and extra["send_email_to_provider"])
        item = json.loads(extra["provider_data"])["receipt"]["items"][0]
        self.assertEqual(item["amount"], {"value": "199.00", "currency": "RUB"})

    def test_rubles_only_without_stars(self):
        with mock.patch.object(game, "PAYMENTS_ENABLED", False):
            self.assertEqual(billing.invoice_params(1, "premium_month")["currency"], "RUB")
            with self.assertRaises(game.QuestError):
                billing.invoice_params(1, "freeze")
            self.assertEqual(billing.premium_view(storage.get_user(1))["buyable"], ["premium_month"])

    def test_old_star_payload_still_accepted(self):
        self.assertEqual(billing.validate_checkout(1, "freeze:1:25", 25, "XTR"), "freeze")


class RevokePremiumTest(TempDBTestCase):
    def test_revoke_beats_env_and_trial(self):
        import admin_tools
        storage.ensure_user(5, "o", "O")
        storage.update_user(5, is_premium=1)
        with mock.patch.object(game, "PREMIUM_USER_IDS", {5, 6}):
            admin_tools.revoke_premium_forever(5)
            user = storage.get_user(5)
            self.assertFalse(game.is_premium(user))
            self.assertFalse(billing.trial_available(user))
            self.assertEqual(game.PREMIUM_USER_IDS, {6})
            billing.grant(5, 3)  # вернуть можно через /grant
            self.assertTrue(game.is_premium(storage.get_user(5)))

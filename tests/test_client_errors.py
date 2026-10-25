import time
import unittest

import client_errors
from webapp_auth import sign_init_data

TOKEN = "123456:TEST"


class ClientErrorsTest(unittest.TestCase):
    def setUp(self):
        client_errors._last.clear()
        client_errors._sent.clear()

    def test_report_names_user_even_with_old_init_data(self):
        init = sign_init_data({"auth_date": int(time.time()) - 10 ** 6,
                               "user": {"id": 42, "first_name": "Андрей<b>", "username": "andr"}}, TOKEN)
        text = client_errors.build_report({"kind": "slow", "initData": init, "platform": "tdesktop", "version": "8.0"},
                                          "1.2.3.4", "Edg/155", TOKEN, now=0)
        self.assertIn("Андрей&lt;b&gt;", text)
        self.assertIn("<code>42</code>", text)
        self.assertIn("tdesktop", text)

    def test_unknown_kind_and_cooldown(self):
        self.assertIsNone(client_errors.build_report({"kind": "hack"}, "ip", "", TOKEN, now=0))
        self.assertIn("неизвестный", client_errors.build_report({"kind": "js_error", "initData": "x"}, "ip", "", TOKEN, now=0))
        self.assertIsNone(client_errors.build_report({"kind": "js_error"}, "ip", "", TOKEN, now=60))  # тот же адрес
        self.assertIsNotNone(client_errors.build_report({"kind": "js_error"}, "ip", "", TOKEN, now=client_errors.PER_KEY_COOLDOWN + 1))

    def test_global_limit(self):
        sent = [client_errors.build_report({"kind": "slow"}, f"ip{i}", "", TOKEN, now=i) for i in range(15)]
        self.assertEqual(sum(1 for s in sent if s), client_errors.GLOBAL_LIMIT[0])

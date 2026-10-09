import time
import unittest

from tests import helpers  # noqa: F401  (путь к модулям проекта)
from webapp_auth import InitDataError, sign_init_data, validate_init_data

TOKEN = "123456789:TEST-TOKEN"


class InitDataTest(unittest.TestCase):
    def signed(self, **extra):
        fields = {"auth_date": int(time.time()), "query_id": "AAE", "user": {"id": 42, "first_name": "Лика"}}
        fields.update(extra)
        return sign_init_data(fields, TOKEN)

    def test_valid(self):
        data = validate_init_data(self.signed(), TOKEN)
        self.assertEqual(data["user"]["id"], 42)
        self.assertEqual(data["user"]["first_name"], "Лика")

    def test_other_bot_token_rejected(self):
        with self.assertRaises(InitDataError):
            validate_init_data(self.signed(), "987654321:OTHER")

    def test_tampered_user_rejected(self):
        tampered = self.signed().replace("%3A42", "%3A43")
        self.assertNotEqual(tampered, self.signed())
        with self.assertRaises(InitDataError):
            validate_init_data(tampered, TOKEN)

    def test_expired_rejected(self):
        old = self.signed(auth_date=int(time.time()) - 2 * 24 * 3600)
        with self.assertRaises(InitDataError):
            validate_init_data(old, TOKEN, max_age=24 * 3600)

    def test_missing_or_garbage(self):
        for bad in ("", "hash=abc", "user=%7B%7D&auth_date=1", "%%%"):
            with self.assertRaises(InitDataError):
                validate_init_data(bad, TOKEN)

    def test_known_vector(self):
        # Пример, посчитанный независимо по алгоритму из документации Telegram.
        import hashlib
        import hmac
        pairs = {"auth_date": "1700000000", "user": '{"id":1,"first_name":"A"}'}
        check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
        secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
        digest = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        from urllib.parse import urlencode
        init = urlencode({**pairs, "hash": digest})
        self.assertEqual(validate_init_data(init, TOKEN, now=1700000100)["user"]["id"], 1)


if __name__ == "__main__":
    unittest.main()

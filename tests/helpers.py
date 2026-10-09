import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import storage  # noqa: E402


class TempDBTestCase(unittest.TestCase):
    """Каждый тест — на своей пустой SQLite-базе."""

    def setUp(self):
        self._dir = tempfile.mkdtemp()
        self._old = storage.DB_PATH
        storage.DB_PATH = os.path.join(self._dir, "test.db")
        storage.init_db()

    def tearDown(self):
        storage.DB_PATH = self._old
        shutil.rmtree(self._dir, ignore_errors=True)

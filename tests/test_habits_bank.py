import re

from tests.helpers import TempDBTestCase
import game
import habit_catalog
import habits
import spheres
import storage
from habits_bank import HABIT_SPHERES

FORBIDDEN = re.compile(r"алкогол|вин[оа]\b|пив[оа]|водк|коньяк|коктейл|сигарет|курени|курить|табак|вейп|кальян|наркот|Маша",
                       re.IGNORECASE)


class CatalogTest(TempDBTestCase):
    def test_eight_spheres_seven_habits_unique_keys(self):
        cat = habit_catalog.catalog()
        self.assertEqual(len(cat), 8)
        self.assertTrue(all(len(sp["habits"]) == 7 for sp in cat))
        keys = [hb["key"] for sp in cat for hb in sp["habits"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(keys), 56)

    def test_habits_belong_to_existing_spheres_and_palette(self):
        for sp in habit_catalog.catalog():
            self.assertIn(sp["key"], HABIT_SPHERES)
            self.assertIn(sp["color"], habits.COLORS)
            for hb in sp["habits"]:
                self.assertEqual(hb["sphere"], sp["key"])
                self.assertIn(hb["schedule"], habits.SCHEDULES)
                self.assertTrue(hb["emoji"] and hb["tiny"] and hb["why"])

    def test_no_forbidden_words(self):
        texts = [f"{sp['name']} {hb['title']} {hb['tiny']} {hb['why']}"
                 for sp in habit_catalog.catalog() for hb in sp["habits"]]
        bad = [t for t in texts if FORBIDDEN.search(t)]
        self.assertEqual(bad, [])


class BankSpheresTest(TempDBTestCase):
    def test_new_user_picks_spheres(self):
        storage.ensure_user(1)
        self.assertEqual(spheres.list_spheres(1), [])  # новому — ни прежних, ни лишних
        self.assertEqual(len(spheres.available(1)), 8)
        lst = spheres.enable(1, ["body", "mind", "nope"])
        self.assertEqual([s["key"] for s in lst], ["body", "mind"])
        spheres.enable(1, ["body"])  # повторно — без дублей
        self.assertEqual(len(spheres.list_spheres(1)), 2)
        self.assertEqual(len(spheres.available(1)), 6)

    def test_catalog_habit_enables_its_sphere_and_has_tip(self):
        storage.ensure_user(2)
        item = habit_catalog.by_key("bed_on_time")
        hb = habits.create_habit(2, {**item, "bank_key": item["key"]})["habit"]
        self.assertEqual(hb["sphere"], "sleep")
        self.assertEqual(hb["tip"], {"tiny": item["tiny"], "why": item["why"]})
        self.assertIn("sleep", spheres.keys(2))
        weekly = habits.create_habit(2, {**habit_catalog.by_key("plan_menu"), "bank_key": "plan_menu"})["habit"]
        self.assertEqual((weekly["schedule"], weekly["per_week"]), ("weekly", 1))
        own = habits.create_habit(2, {"title": "Своя", "bank_key": "nope"})["habit"]
        self.assertIsNone(own["tip"])

    def test_delete_and_rename_bank_sphere(self):
        storage.ensure_user(3)
        spheres.enable(3, ["calm", "creative"])
        spheres.update(3, "calm", {"name": "Тишина"})
        self.assertEqual(next(s for s in spheres.list_spheres(3) if s["key"] == "calm")["name"], "Тишина")
        spheres.reset(3, "calm")
        self.assertEqual(next(s for s in spheres.list_spheres(3) if s["key"] == "calm")["name"], "Спокойствие и настроение")
        hb = habits.create_habit(3, {"title": "Рисую", "sphere": "creative"})["habit"]
        spheres.delete(3, "creative")
        self.assertIsNone(habits.habit_view(3, hb["id"])["sphere"])
        self.assertIn("creative", [s["key"] for s in spheres.available(3)])
        # своя сфера «c<id>» не путается с calm/creative
        spheres.create(3, {"name": "Семья"})
        self.assertEqual(sum(1 for s in spheres.list_spheres(3) if s["custom"]), 1)


class LegacyMigrationTest(TempDBTestCase):
    def _rerun_migration(self):
        conn = storage.connect()
        conn.execute("DELETE FROM meta WHERE key = 'habit_spheres_v2'")
        conn.commit()
        conn.close()
        storage.init_db()
        storage.init_db()  # второй запуск ничего не ломает

    def test_existing_users_keep_spheres_habits_and_streaks(self):
        storage.ensure_user(10)  # пользовался приложением: привычка со старой сферой
        storage.ensure_user(11)  # прошёл приветствие, привычек нет
        storage.ensure_user(12)  # только зашёл в бота
        storage.update_user(11, onboarded=1)
        storage.update_user(10, legacy_spheres=1)
        hb = habits.create_habit(10, {"title": "Зарядка", "sphere": "Энергия"})["habit"]
        storage.update_user(10, legacy_spheres=0)
        habits.log_habit(10, hb["id"], delta=1)
        before = habits.habit_view(10, hb["id"])
        self._rerun_migration()
        self.assertTrue(storage.get_user(10)["legacy_spheres"])
        self.assertTrue(storage.get_user(11)["legacy_spheres"])
        self.assertFalse(storage.get_user(12)["legacy_spheres"])
        after = habits.habit_view(10, hb["id"])
        self.assertEqual((after["sphere"], after["streak"], after["done_today"]),
                         (before["sphere"], before["streak"], before["done_today"]))
        self.assertIn("Энергия", spheres.keys(10))  # прежние сферы на месте
        today = game.local_today(storage.get_user(10))
        self.assertEqual(habits.done_by_sphere(10, today, today), {"Энергия": 1})
        self.assertEqual(len(spheres.available(10)), 8)  # новые сферы просто доступны

    def test_users_after_migration_are_new(self):
        storage.ensure_user(20)
        self.assertFalse(storage.get_user(20).get("legacy_spheres"))
        storage.init_db()  # миграция уже отмечена — повторно не срабатывает
        self.assertFalse(storage.get_user(20).get("legacy_spheres"))

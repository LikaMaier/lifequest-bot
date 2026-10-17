import io
import os
import shutil
import tempfile

from tests.helpers import TempDBTestCase
import albums
import friends
import game
import photos
import storage


def jpeg() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 120, 50)).save(buf, "JPEG")
    return buf.getvalue()


class AlbumsTest(TempDBTestCase):
    def setUp(self):
        super().setUp()
        self._pdir = tempfile.mkdtemp()
        self._old_dir = photos.PHOTOS_DIR
        photos.PHOTOS_DIR = self._pdir
        photos.reset_enabled_cache()
        photos.configure("123:abc")
        for uid, name in ((1, "Лика"), (2, "Маша"), (3, "Оля"), (4, "Чужой")):
            storage.ensure_user(uid)
            storage.update_user(uid, first_name=name)
        friends.add_friend(1, 2)
        friends.add_friend(1, 3)

    def tearDown(self):
        photos.PHOTOS_DIR = self._old_dir
        photos.reset_enabled_cache()
        shutil.rmtree(self._pdir, ignore_errors=True)
        super().tearDown()

    def _album(self):
        return albums.create(1, {"title": "Лето на даче", "emoji": "🏖️"})["album"]

    def test_create_join_by_link_and_invite_friend(self):
        a = self._album()
        self.assertTrue(a["mine"])
        self.assertEqual(friends.parse_start(f"a_{a['id']}"), ("a", a["id"], 1))
        res = albums.join(4, a["id"])  # по ссылке может войти любой
        self.assertEqual(res["messages"][0][0], 1)
        self.assertTrue(friends.are_friends(4, 1))
        self.assertTrue(albums.join(4, a["id"])["already"])
        res = albums.invite(1, a["id"], 2)
        self.assertEqual(res["messages"][0][0], 2)
        with self.assertRaises(game.QuestError):
            albums.invite(1, a["id"], 2)  # уже в альбоме
        with self.assertRaises(game.QuestError):
            albums.invite(2, a["id"], 3)  # 2 и 3 не друзья
        self.assertEqual(len(albums.list_view(2)["albums"]), 1)

    def test_members_share_photos_strangers_dont(self):
        a = self._album()
        albums.invite(1, a["id"], 2)
        with self.assertRaises(game.QuestError):
            photos.save_upload(4, jpeg(), {"target": "album", "album_id": a["id"]})
        for _ in range(6):  # лимит «5 на элемент» к альбому не относится
            photos.save_upload(2, jpeg(), {"target": "album", "album_id": a["id"]})
        mine = photos.save_upload(1, jpeg(), {"target": "album", "album_id": a["id"]})["photo"]
        v = albums.view(1, a["id"])
        self.assertEqual(v["count"], 7)
        self.assertEqual({p["by"] for p in v["photos"]}, {"Ты", "Маша"})
        # фото общего альбома не попадают в личный альбом
        self.assertEqual(photos.list_photos(2, {}), [])
        # подписанная ссылка открывает файл загрузившего
        p2 = next(p for p in v["photos"] if not p["mine"])
        q = dict(x.split("=") for x in p2["thumb"].split("?")[1].split("&"))
        self.assertTrue(photos.verify(int(q["u"]), p2["id"], "thumb", int(q["exp"]), q["sig"]))
        self.assertTrue(photos.file_path(int(q["u"]), p2["id"], "thumb"))
        with self.assertRaises(game.QuestError):
            albums.view(4, a["id"])
        # своё фото удаляет автор, чужое — только создатель
        with self.assertRaises(game.QuestError):
            albums.delete_photo(2, a["id"], mine["id"])
        albums.delete_photo(1, a["id"], p2["id"])
        self.assertEqual(albums.view(2, a["id"])["count"], 6)

    def test_leave_and_owner_deletes_album(self):
        a = self._album()
        albums.invite(1, a["id"], 2)
        photos.save_upload(2, jpeg(), {"target": "album", "album_id": a["id"]})
        albums.leave(2, a["id"])
        self.assertEqual(albums.list_view(2)["albums"], [])
        albums.invite(1, a["id"], 2)
        res = albums.leave(1, a["id"])
        self.assertTrue(res["deleted"])
        self.assertEqual(res["messages"][0][0], 2)
        with self.assertRaises(game.QuestError):
            albums.view(1, a["id"])
        self.assertEqual(photos.stats(2)["count"], 0)

    def test_open_my_album_to_friend(self):
        photos.save_upload(1, jpeg(), {"target": "day", "day": game.local_today(storage.get_user(1)).isoformat()})
        with self.assertRaises(game.QuestError):
            albums.friend_album(2, 1)
        with self.assertRaises(game.QuestError):
            albums.set_access(1, 4, True)  # не друг
        res = albums.set_access(1, 2, True)
        self.assertEqual(res["messages"][0][0], 2)
        self.assertTrue(next(f for f in res["access"] if f["id"] == 2)["on"])
        self.assertFalse(next(f for f in res["access"] if f["id"] == 3)["on"])
        fa = albums.friend_album(2, 1)
        self.assertEqual(len(fa["photos"]), 1)
        self.assertFalse(fa["photos"][0]["can_delete"])
        lv = albums.list_view(2)
        self.assertEqual(lv["friends"][0]["id"], 1)
        self.assertEqual(lv["friends"][0]["count"], 1)
        self.assertEqual(albums.list_view(1)["granted"], 1)
        with self.assertRaises(game.QuestError):
            albums.friend_album(3, 1)
        albums.set_access(1, 2, False)
        with self.assertRaises(game.QuestError):
            albums.friend_album(2, 1)

    def test_delete_user_cleans_albums(self):
        a = self._album()
        albums.invite(1, a["id"], 2)
        photos.save_upload(2, jpeg(), {"target": "album", "album_id": a["id"]})
        albums.set_access(1, 2, True)
        b = albums.create(2, {"title": "Машин"})["album"]
        albums.join(1, b["id"])
        photos.delete_all(1)
        storage.delete_user_data(1)
        self.assertEqual(albums.list_view(2)["albums"][0]["id"], b["id"])
        self.assertEqual(albums.list_view(2)["friends"], [])
        self.assertEqual(photos.stats(2)["count"], 0)  # фото Маши в удалённом альбоме Лики
        self.assertEqual(os.listdir(os.path.join(self._pdir, "2")), [])

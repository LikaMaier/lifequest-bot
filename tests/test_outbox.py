from tests.helpers import TempDBTestCase
import outbox


class OutboxTest(TempDBTestCase):
    def test_new_folders_once(self):
        listing = [{"name": "2026-11-05-interstellar", "type": "dir"}, {"name": "README.md", "type": "file"},
                   {"name": "2026-11-04-egypt", "type": "dir"}]
        self.assertEqual(outbox.new_folders(listing), ["2026-11-04-egypt", "2026-11-05-interstellar"])
        outbox.mark_sent("2026-11-04-egypt")
        self.assertEqual(outbox.new_folders(listing), ["2026-11-05-interstellar"])

    def test_parse_folder(self):
        files = [{"name": "b-sfx.mp4", "type": "file", "size": 7_000_000, "download_url": "u2"},
                 {"name": "a-music.mp4", "type": "file", "size": 8_000_000, "download_url": "u1"},
                 {"name": "huge.mp4", "type": "file", "size": 90_000_000, "download_url": "u3"},
                 {"name": "caption.txt", "type": "file", "size": 500, "download_url": "c"},
                 {"name": "title.txt", "type": "file", "size": 20, "download_url": "t"}]
        item = outbox.parse_folder(files)
        self.assertEqual(item["videos"], [("a-music.mp4", "u1"), ("b-sfx.mp4", "u2")])
        self.assertEqual((item["caption"], item["title"]), ("c", "t"))

    def test_caption_labels(self):
        self.assertEqual(outbox.video_caption("Сирень", "x-music.mp4", 2), "🎬 Сирень · с музыкой")
        self.assertEqual(outbox.video_caption("Сирень", "x-sfx.mp4", 2), "🎬 Сирень · только звуки")
        self.assertEqual(outbox.video_caption("Сирень", "x.mp4", 1), "🎬 Сирень")

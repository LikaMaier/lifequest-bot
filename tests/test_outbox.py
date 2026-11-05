from datetime import datetime, timedelta, timezone

from tests.helpers import TempDBTestCase
import outbox

NOW = datetime(2026, 11, 5, 21, 0, tzinfo=timezone.utc)


def rel(tag, days_ago=0, assets=None, draft=False, body="Подпись #мотивация"):
    return {"tag_name": tag, "name": "Интерстеллар", "draft": draft, "body": body,
            "published_at": (NOW - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z"),
            "assets": assets if assets is not None else [
                {"name": "a-music.mp4", "size": 7_000_000, "browser_download_url": "https://x/a-music.mp4"},
                {"name": "a-sfx.mp4", "size": 6_000_000, "browser_download_url": "https://x/a-sfx.mp4"},
                {"name": "notes.txt", "size": 10, "browser_download_url": "https://x/n.txt"}]}


class OutboxTest(TempDBTestCase):
    def test_pending_filters(self):
        items = outbox.pending([rel("outbox-new"), rel("v1.0"), rel("outbox-old", days_ago=9),
                                rel("outbox-draft", draft=True)], NOW)
        self.assertEqual([i["tag"] for i in items], ["outbox-new"])
        self.assertEqual([n for n, _ in items[0]["videos"]], ["a-music.mp4", "a-sfx.mp4"])
        self.assertEqual(items[0]["body"], "Подпись #мотивация")

    def test_sent_once_and_big_files_skipped(self):
        outbox.mark_sent("outbox-new")
        self.assertEqual(outbox.pending([rel("outbox-new")], NOW), [])
        big = rel("outbox-big", assets=[{"name": "b.mp4", "size": 80_000_000, "browser_download_url": "u"}])
        self.assertEqual(outbox.pending([big], NOW)[0]["videos"], [])

    def test_caption_labels(self):
        item = outbox.pending([rel("outbox-x")], NOW)[0]
        self.assertEqual(outbox.video_caption(item, "a-music.mp4", 0, 2), "🎬 Интерстеллар · с музыкой")
        self.assertEqual(outbox.video_caption(item, "a-sfx.mp4", 1, 2), "🎬 Интерстеллар · только звуки")

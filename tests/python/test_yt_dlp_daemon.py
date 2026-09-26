"""Tests for scripts/yt-dlp-daemon.py. Run with:

  python3 tests/python/test_yt_dlp_daemon.py

`npm test` runs this file through tests/yt-dlp-daemon.test.ts. yt_dlp is
stubbed, so neither the package nor the network is needed.
"""

import http.client
import importlib.util
import json
import pathlib
import sys
import threading
import time
import types
import unittest
from http.server import ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[2]
# Loading the daemon would otherwise leave a __pycache__ inside scripts/.
sys.dont_write_bytecode = True


class FakeYoutubeDL:
    def __init__(self, options):
        self.options = options

    def extract_info(self, url, download=False):
        raise AssertionError("tests replace Daemon._extract or _head_status")


sys.modules["yt_dlp"] = types.SimpleNamespace(YoutubeDL=FakeYoutubeDL)
_spec = importlib.util.spec_from_file_location(
    "yt_dlp_daemon", ROOT / "scripts" / "yt-dlp-daemon.py"
)
daemon_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(daemon_module)

VIDEO = "dQw4w9WgXcQ"


def stream_url(expire=None):
    query = "itag=251"
    if expire is not None:
        query += f"&expire={expire}"
    return f"https://rr1---sn-test.googlevideo.com/videoplayback?{query}"


class VideoIdTest(unittest.TestCase):
    def test_accepts_every_youtube_link_shape(self):
        links = [
            f"https://www.youtube.com/watch?v={VIDEO}",
            f"https://music.youtube.com/watch?v={VIDEO}&list=RDAMVM{VIDEO}",
            f"https://youtu.be/{VIDEO}?si=abc",
            f"https://www.youtube.com/shorts/{VIDEO}",
            f"https://www.youtube.com/live/{VIDEO}?feature=share",
            f"https://www.youtube.com/embed/{VIDEO}",
            f"https://m.youtube.com/watch?feature=share&v={VIDEO}",
        ]
        for link in links:
            with self.subTest(link=link):
                self.assertEqual(daemon_module.Daemon._video_id(link), VIDEO)

    def test_rejects_links_without_a_valid_id(self):
        for link in [
            "https://www.youtube.com/playlist?list=PL123",
            "https://youtu.be/",
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/shorts/",
        ]:
            with self.subTest(link=link):
                self.assertIsNone(daemon_module.Daemon._video_id(link))


class ResolveTest(unittest.TestCase):
    def setUp(self):
        self.daemon = daemon_module.Daemon()
        self.calls = []

    def fake_extract(self, result, delay=0.0, gate=None):
        def extract(url, video_id):
            self.calls.append((url, video_id))
            if gate is not None:
                gate.wait(5)
            if delay:
                time.sleep(delay)
            if isinstance(result, Exception):
                raise result
            return result

        self.daemon._extract = extract

    def test_short_links_resolve_instead_of_crashing(self):
        # Regression: `pending` was unbound for links without `v=`, so
        # youtu.be and /shorts/ raised UnboundLocalError.
        self.fake_extract({"url": stream_url(), "id": VIDEO})
        for link in [f"https://youtu.be/{VIDEO}", f"https://youtube.com/shorts/{VIDEO}"]:
            with self.subTest(link=link):
                self.assertEqual(self.daemon.resolve(link)["id"], VIDEO)

    def test_links_without_an_id_still_reach_the_extractor(self):
        self.fake_extract({"error": "no playable audio format found"})
        result = self.daemon.resolve("https://www.youtube.com/playlist?list=PL1")
        self.assertEqual(result, {"error": "no playable audio format found"})
        self.assertEqual(self.calls[0][1], None)

    def test_rejects_hosts_outside_youtube(self):
        self.fake_extract({"url": stream_url()})
        result = self.daemon.resolve(f"https://example.com/watch?v={VIDEO}")
        self.assertIn("error", result)
        self.assertEqual(self.calls, [])

    def test_concurrent_requests_for_one_video_share_one_extraction(self):
        gate = threading.Event()
        self.fake_extract({"url": stream_url(), "id": VIDEO}, gate=gate)
        results = []

        def worker(link):
            results.append(self.daemon.resolve(link))

        links = [
            f"https://www.youtube.com/watch?v={VIDEO}",
            f"https://youtu.be/{VIDEO}",
            f"https://music.youtube.com/watch?v={VIDEO}",
        ]
        threads = [threading.Thread(target=worker, args=(link,)) for link in links]
        for thread in threads:
            thread.start()
        deadline = time.time() + 5
        while len(self.daemon.inflight) == 0 and time.time() < deadline:
            time.sleep(0.01)
        time.sleep(0.05)
        gate.set()
        for thread in threads:
            thread.join(5)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(results), 3)
        self.assertTrue(all(result["id"] == VIDEO for result in results))
        self.assertEqual(self.daemon.inflight, {})

    def test_waiters_get_an_error_when_the_extraction_raises(self):
        gate = threading.Event()
        self.fake_extract(RuntimeError("boom"), gate=gate)
        owner_errors = []
        waiter_results = []

        def owner():
            try:
                self.daemon.resolve(f"https://youtu.be/{VIDEO}")
            except RuntimeError as error:
                owner_errors.append(error)

        def waiter():
            waiter_results.append(
                self.daemon.resolve(f"https://www.youtube.com/watch?v={VIDEO}")
            )

        first = threading.Thread(target=owner)
        first.start()
        deadline = time.time() + 5
        while len(self.daemon.inflight) == 0 and time.time() < deadline:
            time.sleep(0.01)
        second = threading.Thread(target=waiter)
        second.start()
        time.sleep(0.05)
        gate.set()
        first.join(5)
        second.join(5)
        self.assertFalse(second.is_alive())
        self.assertEqual(len(owner_errors), 1)
        self.assertEqual(waiter_results, [{"error": "resolution failed"}])
        self.assertEqual(self.daemon.inflight, {})

    def test_waiters_give_up_after_the_wait_timeout(self):
        original = daemon_module.WAIT_TIMEOUT_S
        daemon_module.WAIT_TIMEOUT_S = 0.1
        gate = threading.Event()
        try:
            self.fake_extract({"url": stream_url(), "id": VIDEO}, gate=gate)
            owner = threading.Thread(
                target=self.daemon.resolve, args=(f"https://youtu.be/{VIDEO}",)
            )
            owner.start()
            deadline = time.time() + 5
            while len(self.daemon.inflight) == 0 and time.time() < deadline:
                time.sleep(0.01)
            result = self.daemon.resolve(f"https://www.youtube.com/watch?v={VIDEO}")
            self.assertIn("timed out", result["error"])
        finally:
            gate.set()
            owner.join(5)
            daemon_module.WAIT_TIMEOUT_S = original

    def test_a_busy_extractor_times_out_instead_of_blocking_forever(self):
        original = daemon_module.WAIT_TIMEOUT_S
        daemon_module.WAIT_TIMEOUT_S = 0.1
        self.daemon.extract_lock.acquire()
        try:
            result = self.daemon.resolve(f"https://youtu.be/{VIDEO}")
            self.assertIn("timed out", result["error"])
            self.assertEqual(self.daemon.inflight, {})
        finally:
            self.daemon.extract_lock.release()
            daemon_module.WAIT_TIMEOUT_S = original


class CacheTest(unittest.TestCase):
    def setUp(self):
        self.daemon = daemon_module.Daemon()

    def test_expiry_comes_from_the_signed_url_minus_a_margin(self):
        now = 1_000_000.0
        expire = now + 3600
        self.assertEqual(
            daemon_module.Daemon._expire_ts(stream_url(int(expire)), now),
            expire - daemon_module.EXPIRY_MARGIN_S,
        )

    def test_expiry_is_capped_and_defaults_to_the_ttl(self):
        now = 1_000_000.0
        ceiling = now + daemon_module.DEFAULT_TTL_S
        far = stream_url(int(now + 48 * 3600))
        self.assertEqual(daemon_module.Daemon._expire_ts(far, now), ceiling)
        self.assertEqual(daemon_module.Daemon._expire_ts(stream_url(), now), ceiling)
        self.assertEqual(
            daemon_module.Daemon._expire_ts(stream_url("soon"), now), ceiling
        )

    def test_urls_about_to_expire_are_not_cached(self):
        soon = int(time.time() + 60)
        self.daemon._cache(VIDEO, {"url": stream_url(soon)})
        self.assertEqual(self.daemon.cache, {})

    def test_cached_urls_are_served_until_they_expire(self):
        later = int(time.time() + 3600)
        self.daemon._cache(VIDEO, {"url": stream_url(later), "format_id": "251"})
        self.daemon._extract = lambda url, video_id: self.fail("should hit cache")
        result = self.daemon.resolve(f"https://youtu.be/{VIDEO}")
        self.assertEqual(result["cached"], True)
        self.assertEqual(result["format_id"], "251")

        self.daemon.cache[VIDEO]["expire_ts"] = time.time() - 1
        self.daemon._extract = lambda url, video_id: {"url": "fresh"}
        self.assertEqual(self.daemon.resolve(f"https://youtu.be/{VIDEO}"), {"url": "fresh"})
        self.assertNotIn(VIDEO, self.daemon.cache)

    def test_extract_caches_a_validated_url(self):
        later = int(time.time() + 3600)

        class Client:
            def extract_info(self, url, download=False):
                return {"url": stream_url(later), "id": VIDEO, "format_id": "251"}

        self.daemon.ydl_embedded = Client()
        self.daemon._head_status = lambda url, via_proxy: 200
        result = self.daemon.resolve(f"https://www.youtube.com/shorts/{VIDEO}")
        self.assertEqual(result["format_id"], "251")
        self.assertIn(VIDEO, self.daemon.cache)

    def test_invalidate_accepts_short_links(self):
        self.daemon._cache(VIDEO, {"url": stream_url(int(time.time() + 3600))})
        self.assertEqual(
            self.daemon.invalidate(f"https://youtu.be/{VIDEO}"),
            {"invalidated": True, "id": VIDEO},
        )


class HandlerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class FakeDaemon:
            def resolve(self, url):
                if "raise" in url:
                    raise RuntimeError("broken")
                return {"url": stream_url(), "id": VIDEO, "asked": url}

            def invalidate(self, url):
                return {"invalidated": False, "id": VIDEO}

        daemon_module.Handler.daemon = FakeDaemon()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), daemon_module.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        daemon_module.Handler.daemon = None

    def get(self, path):
        # http.client, not urllib: urllib applies the system proxy (the
        # Windows registry, or http_proxy), which sent these localhost
        # requests to a proxy and timed out on Windows.
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request("GET", path)
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_routes_resolve_and_invalidate(self):
        status, body = self.get("/resolve?url=https%3A%2F%2Fyoutu.be%2F" + VIDEO)
        self.assertEqual(status, 200)
        self.assertEqual(body["asked"], f"https://youtu.be/{VIDEO}")
        status, body = self.get("/invalidate?url=https%3A%2F%2Fyoutu.be%2F" + VIDEO)
        self.assertEqual((status, body["invalidated"]), (200, False))

    def test_unknown_paths_are_not_found(self):
        # Used to resolve any path, including /favicon.ico?url=...
        status, body = self.get("/anything?url=https%3A%2F%2Fyoutu.be%2F" + VIDEO)
        self.assertEqual((status, body), (404, {"error": "not found"}))

    def test_missing_url_and_handler_errors_answer_json(self):
        self.assertEqual(self.get("/resolve"), (200, {"error": "missing url"}))
        status, body = self.get("/resolve?url=raise")
        self.assertEqual((status, body), (500, {"error": "broken"}))


if __name__ == "__main__":
    unittest.main()

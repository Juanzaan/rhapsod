#!/usr/bin/env python3
"""Persistent yt-dlp daemon that resolves YouTube audio stream URLs fast.

Resolutions run through a single `yt_dlp.YoutubeDL` worker under a lock:
parallel extraction is intentionally avoided because YouTube rate-limits the
datacenter IP, so concurrent calls degrade every request. Duplicate in-flight
requests for the same video share one extraction. Resolves with
`player_client=web_embedded` (no PO token needed for most videos), caching the
resolved URL per video ID (URLs expire in ~6h).

Usage:
  PYTHONPATH=/path/to/yt_dlp_package python3 scripts/yt-dlp-daemon.py

Environment:
  RHAPSOD_YTDLP_DAEMON_HOST    bind host (default 127.0.0.1)
  RHAPSOD_YTDLP_DAEMON_PORT    bind port (default 8765)
  RHAPSOD_YTDLP_COOKIES_PATH   youtube cookies file (default
                               /home/rhapsod/youtube-cookies.txt)
  RHAPSOD_WARP_PROXY           optional fallback egress for blocked fetches
                               (e.g. socks5h://127.0.0.1:40000 for Cloudflare
                               WARP in proxy mode). Empty/disabled by default.
                               When set, extraction and URL validation retry
                               through the proxy after direct attempts fail.

Endpoints:
  GET /resolve?url=<encoded youtube url>
  -> {"url": "...", "id": "...", "format_id": "...", "cached": true?,
      "egress": "warp"?}
  or {"error": "..."}
  GET /invalidate?url=<encoded youtube url>
  -> {"invalidated": bool, "id": "..."} or {"error": "..."}
  Any other path answers 404.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlparse, parse_qs

import yt_dlp

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
PATH_ID_PREFIXES = ("shorts", "live", "embed", "v")
COOKIES_PATH = os.environ.get(
    "RHAPSOD_YTDLP_COOKIES_PATH", "/home/rhapsod/youtube-cookies.txt"
)
HOST = os.environ.get("RHAPSOD_YTDLP_DAEMON_HOST", "127.0.0.1")
PORT = int(os.environ.get("RHAPSOD_YTDLP_DAEMON_PORT", "8765"))
# Optional fallback egress (e.g. socks5h://127.0.0.1:40000). Empty = disabled.
WARP_PROXY = os.environ.get("RHAPSOD_WARP_PROXY", "")
CURL_BIN = shutil.which("curl")
# The bot gives up on the daemon after 15 s. Waiting much longer only piles
# up blocked threads, and an extraction that never returns would otherwise
# hold every later request for the same video forever.
WAIT_TIMEOUT_S = 45
DEFAULT_TTL_S = 6 * 3600
# googlevideo URLs stop working at `expire`; a track that starts right
# before that point fails mid-song, so stop handing the URL out early.
EXPIRY_MARGIN_S = 15 * 60
MAX_CACHE_ENTRIES = 500

BASE = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "force_ipv4": True,
    "socket_timeout": 5,
    "extractor_retries": 2,
    "fragment_retries": 2,
    "cookiefile": COOKIES_PATH,
    "extract_flat": "discard",
    "js_runtimes": {"node": {}},
    "remote_components": {"ejs": "github"},
    "extractor_args": {
        "youtube": {
            "player_client": ["web_embedded"],
            "player_skip": ["webpage", "initial_data"],
            "skip": ["hls", "dash"],
            "po_token_uri": "http://127.0.0.1:4416/get_pot",
        }
    },
}


class _Pending:
    def __init__(self):
        self.event = threading.Event()
        self.result = None

    def wait(self, timeout):
        if not self.event.wait(timeout):
            return None
        return self.result

    def set(self, result):
        self.result = result
        self.event.set()


ALLOWED_YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}


class Daemon:
    def __init__(self):
        self.ydl_embedded = yt_dlp.YoutubeDL(dict(BASE, format="bestaudio/best"))
        # Fallback client for videos that return 403/no format via web_embedded (e.g. music-only)
        base_safari = dict(BASE)
        base_safari["extractor_args"] = {
            "youtube": {
                "player_client": ["web_safari"],
                "player_skip": ["webpage", "initial_data"],
                "skip": ["hls", "dash"],
                "po_token_uri": "http://127.0.0.1:4416/get_pot",
            }
        }
        self.ydl_safari = yt_dlp.YoutubeDL(dict(base_safari, format="bestaudio/best"))
        # Optional WARP-proxy extraction clients (same clients, different
        # egress). Built lazily only when RHAPSOD_WARP_PROXY is configured.
        if WARP_PROXY:
            self.ydl_embedded_proxy = yt_dlp.YoutubeDL(
                dict(BASE, format="bestaudio/best", proxy=WARP_PROXY)
            )
            proxy_safari = dict(base_safari)
            proxy_safari["proxy"] = WARP_PROXY
            self.ydl_safari_proxy = yt_dlp.YoutubeDL(
                dict(proxy_safari, format="bestaudio/best")
            )
        else:
            self.ydl_embedded_proxy = None
            self.ydl_safari_proxy = None
        self.extract_lock = Lock()
        self.cache_lock = Lock()
        self.cache = {}
        self.inflight = {}

    @staticmethod
    def _video_id(url):
        try:
            parsed = urlparse(url)
        except ValueError:
            return None
        candidates = parse_qs(parsed.query).get("v", [])
        segments = [part for part in parsed.path.split("/") if part]
        if parsed.hostname == "youtu.be" and segments:
            candidates.append(segments[0])
        if len(segments) >= 2 and segments[0] in PATH_ID_PREFIXES:
            candidates.append(segments[1])
        for candidate in candidates:
            if VIDEO_ID_RE.match(candidate):
                return candidate
        return None

    @staticmethod
    def _allowed(url):
        try:
            parsed = urlparse(url)
        except ValueError:
            return False
        return (
            parsed.scheme in ("http", "https")
            and parsed.hostname in ALLOWED_YOUTUBE_HOSTS
        )

    def resolve(self, url):
        if not self._allowed(url):
            return {"error": "only YouTube URLs are allowed"}
        video_id = self._video_id(url)
        if not video_id:
            return self._extract_serialized(url, None)
        # Cache lookup and in-flight registration share one critical section:
        # checked separately, two requests could both miss and both extract.
        with self.cache_lock:
            cached = self._cached(video_id)
            if cached is not None:
                return cached
            pending = self.inflight.get(video_id)
            owner = pending is None
            if owner:
                pending = _Pending()
                self.inflight[video_id] = pending
        if not owner:
            result = pending.wait(WAIT_TIMEOUT_S)
            if result is None:
                return {"error": "timed out waiting for the same video"}
            return result
        result = {"error": "resolution failed"}
        try:
            result = self._extract_serialized(url, video_id)
            return result
        finally:
            with self.cache_lock:
                self.inflight.pop(video_id, None)
            pending.set(result)

    def _extract_serialized(self, url, video_id):
        if not self.extract_lock.acquire(timeout=WAIT_TIMEOUT_S):
            return {"error": "timed out waiting for the extractor"}
        try:
            return self._extract(url, video_id)
        finally:
            self.extract_lock.release()

    def _cached(self, video_id):
        entry = self.cache.get(video_id)
        if entry is None:
            return None
        if entry["expire_ts"] <= time.time():
            del self.cache[video_id]
            return None
        return {
            "url": entry["url"],
            "id": video_id,
            "format_id": entry["format_id"],
            "cached": True,
        }

    @staticmethod
    def _head_status(test_url, via_proxy):
        """HEAD-check a stream URL. Returns the HTTP status, or None when the
        check itself is inconclusive (caller should still try the URL)."""
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        if via_proxy:
            if not CURL_BIN:
                return None
            try:
                proc = subprocess.run(
                    [
                        CURL_BIN,
                        "-s",
                        "-o",
                        "/dev/null",
                        "-w",
                        "%{http_code}",
                        "-m",
                        "8",
                        "--proxy",
                        WARP_PROXY,
                        "-I",
                        "-A",
                        user_agent,
                        test_url,
                    ],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                code = int(proc.stdout.strip())
                return code
            except Exception:
                return None
        try:
            import urllib.request

            req = urllib.request.Request(test_url, method="HEAD")
            req.add_header("User-Agent", user_agent)
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status
        except Exception:
            return None

    def _extract(self, url, video_id):
        last_error = None
        attempts = [
            (self.ydl_embedded, False),
            (self.ydl_safari, False),
        ]
        # Fallback egress: same clients through the proxy, only when configured.
        if self.ydl_embedded_proxy is not None:
            attempts.append((self.ydl_embedded_proxy, True))
        if self.ydl_safari_proxy is not None:
            attempts.append((self.ydl_safari_proxy, True))
        for ydl, via_proxy in attempts:
            try:
                info = ydl.extract_info(url, download=False)
                if not info.get("url"):
                    last_error = "no playable audio format found"
                    continue
                # Validate URL is not 403 before caching (transient CDN 403)
                status = self._head_status(info["url"], via_proxy)
                if status == 403:
                    last_error = "Server returned 403 Forbidden (access denied)"
                    continue
                self._cache(video_id, info)
                result = {
                    "url": info["url"],
                    "id": info.get("id"),
                    "format_id": info.get("format_id"),
                }
                if via_proxy:
                    result["egress"] = "warp"
                return result
            except Exception as error:
                last_error = str(error)
                continue
        return {"error": last_error or "no playable audio format found"}

    def invalidate(self, url):
        """Drop a cached URL for a video so a 403'd host is re-resolved fresh."""
        video_id = self._video_id(url)
        if not video_id:
            return {"error": "invalid url"}
        with self.cache_lock:
            removed = self.cache.pop(video_id, None)
        return {"invalidated": removed is not None, "id": video_id}

    @staticmethod
    def _expire_ts(stream_url, now):
        """When to stop serving a URL: its signed `expire` minus a margin,
        capped at the default TTL. yt-dlp does not expose the expiry as an
        info field; it only lives in the URL."""
        expire = None
        try:
            raw = parse_qs(urlparse(stream_url).query).get("expire", [None])[0]
            expire = float(raw) if raw is not None else None
        except ValueError:
            expire = None
        ceiling = now + DEFAULT_TTL_S
        if expire is None:
            return ceiling
        return min(expire - EXPIRY_MARGIN_S, ceiling)

    def _cache(self, video_id, info):
        if not video_id or not info.get("url"):
            return
        now = time.time()
        expire_ts = self._expire_ts(info["url"], now)
        if expire_ts <= now:
            return
        with self.cache_lock:
            self.cache[video_id] = {
                "expire_ts": expire_ts,
                "url": info["url"],
                "format_id": info.get("format_id"),
            }
            if len(self.cache) > MAX_CACHE_ENTRIES:
                oldest = min(self.cache, key=lambda k: self.cache[k]["expire_ts"])
                del self.cache[oldest]


def log_failure(action, message):
    # The access log stays off (one line per song is noise), but failures
    # go to stderr so journald keeps them: before, a broken daemon only
    # showed up as slower song starts in the bot.
    sys.stderr.write(f"rhapsod-ytdlp-daemon: {action} failed: {message}\n")
    sys.stderr.flush()


class Handler(BaseHTTPRequestHandler):
    daemon = None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in ("/resolve", "/invalidate"):
            self._json({"error": "not found"}, status=404)
            return
        url = parse_qs(parsed.query).get("url", [""])[0]
        if not url:
            self._json({"error": "missing url"})
            return
        try:
            if parsed.path == "/invalidate":
                self._json(self.daemon.invalidate(url))
            else:
                result = self.daemon.resolve(url)
                if "error" in result:
                    log_failure("resolve", result["error"])
                self._json(result)
        except Exception as error:
            log_failure(parsed.path.lstrip("/"), str(error))
            self._json({"error": str(error)}, status=500)

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        # One write for status line, headers and body. On some Windows hosts
        # a response split across two sends (end_headers, then the body)
        # never delivered the body, and the client timed out reading it.
        head = (
            f"{self.protocol_version} {status} {HTTPStatus(status).phrase}\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("latin-1")
        self.close_connection = True
        self.wfile.write(head + body)

    def log_message(self, *args):
        pass


def main():
    Handler.daemon = Daemon()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
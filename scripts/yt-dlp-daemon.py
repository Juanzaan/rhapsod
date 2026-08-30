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

Endpoint:
  GET /resolve?url=<encoded youtube watch url>
  -> {"url": "...", "id": "...", "format_id": "...", "cached": true?}
  or {"error": "..."}
"""

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlparse, parse_qs

import yt_dlp

VIDEO_ID_RE = re.compile(r"[?&]v=([A-Za-z0-9_-]{11})")
COOKIES_PATH = os.environ.get(
    "RHAPSOD_YTDLP_COOKIES_PATH", "/home/rhapsod/youtube-cookies.txt"
)
HOST = os.environ.get("RHAPSOD_YTDLP_DAEMON_HOST", "127.0.0.1")
PORT = int(os.environ.get("RHAPSOD_YTDLP_DAEMON_PORT", "8765"))

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
        }
    },
}


class _Pending:
    def __init__(self):
        self.event = threading.Event()
        self.result = None

    def wait(self):
        self.event.wait()
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
            }
        }
        self.ydl_safari = yt_dlp.YoutubeDL(dict(base_safari, format="bestaudio/best"))
        self.extract_lock = Lock()
        self.cache_lock = Lock()
        self.cache = {}
        self.inflight = {}

    @staticmethod
    def _video_id(url):
        match = VIDEO_ID_RE.search(url)
        return match.group(1) if match else None

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
        with self.cache_lock:
            entry = self.cache.get(video_id)
            if entry is not None:
                if entry["expire_ts"] > time.time():
                    return {
                        "url": entry["url"],
                        "id": video_id,
                        "format_id": entry["format_id"],
                        "cached": True,
                    }
                del self.cache[video_id]
        if video_id:
            with self.cache_lock:
                pending = self.inflight.get(video_id)
            if pending is not None:
                return pending.wait()
            pending = _Pending()
            with self.cache_lock:
                self.inflight[video_id] = pending
        try:
            with self.extract_lock:
                result = self._extract(url, video_id)
            if pending is not None:
                pending.set(result)
            return result
        finally:
            if video_id:
                with self.cache_lock:
                    self.inflight.pop(video_id, None)

    def _extract(self, url, video_id):
        last_error = None
        for ydl in (self.ydl_embedded, self.ydl_safari):
            try:
                info = ydl.extract_info(url, download=False)
                if not info.get("url"):
                    last_error = "no playable audio format found"
                    continue
                # Validate URL is not 403 before caching (transient CDN 403)
                test_url = info["url"]
                try:
                    import urllib.request

                    req = urllib.request.Request(test_url, method="HEAD")
                    req.add_header(
                        "User-Agent",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    )
                    with urllib.request.urlopen(req, timeout=3) as resp:
                        if resp.status == 403:
                            last_error = "Server returned 403 Forbidden (access denied)"
                            continue
                except Exception:
                    # If HEAD fails for other reason, still try to use URL
                    pass
                self._cache(video_id, info)
                return {
                    "url": info["url"],
                    "id": info.get("id"),
                    "format_id": info.get("format_id"),
                }
            except Exception as error:
                last_error = str(error)
                continue
        return {"error": last_error or "no playable audio format found"}

    def _cache(self, video_id, info):
        if not video_id or not info.get("url"):
            return
        expire_ts = info.get("expires") or (time.time() + 6 * 3600)
        with self.cache_lock:
            self.cache[video_id] = {
                "expire_ts": expire_ts,
                "url": info["url"],
                "format_id": info.get("format_id"),
            }
            if len(self.cache) > 500:
                oldest = min(self.cache, key=lambda k: self.cache[k]["expire_ts"])
                del self.cache[oldest]


daemon = Daemon()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        url = qs.get("url", [""])[0]
        if not url:
            self._json({"error": "missing url"})
            return
        self._json(daemon.resolve(url))

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
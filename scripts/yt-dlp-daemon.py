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

Endpoint:
  GET /resolve?url=<encoded youtube watch url>
  -> {"url": "...", "id": "...", "format_id": "...", "cached": true?,
      "egress": "warp"?}
  or {"error": "..."}
"""

import json
import os
import re
import shutil
import subprocess
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
# Optional fallback egress (e.g. socks5h://127.0.0.1:40000). Empty = disabled.
WARP_PROXY = os.environ.get("RHAPSOD_WARP_PROXY", "")
CURL_BIN = shutil.which("curl")

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
        if self.path.startswith("/invalidate"):
            self._json(daemon.invalidate(url))
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
#!/usr/bin/env python3
"""Persistent yt-dlp daemon that resolves YouTube audio stream URLs fast.

Keeps a single `yt_dlp.YoutubeDL` alive (no per-call Python startup) and
resolves audio URLs with `player_client=web_embedded` (no PO token needed for
most videos), caching the resolved URL per video ID (URLs expire in ~6h).

Usage:
  PYTHONPATH=/path/to/yt_dlp_package python3 scripts/yt-dlp-daemon.py

Environment:
  RHAPSOD_YTDLP_DAEMON_HOST  bind host (default 127.0.0.1)
  RHAPSOD_YTDLP_DAEMON_PORT  bind port (default 8765)
  RHAPSOD_YTDLP_COOKIES_PATH youtube cookies file (default
                             /home/rhapsod/youtube-cookies.txt)

Endpoint:
  GET /resolve?url=<encoded youtube watch url>
  -> {"url": "...", "id": "...", "format_id": "...", "cached": true?}
  or {"error": "..."}
"""

import json
import os
import re
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


class Daemon:
    def __init__(self):
        self.ydl = yt_dlp.YoutubeDL(dict(BASE, format="bestaudio/best"))
        self.lock = Lock()
        self.cache = {}

    @staticmethod
    def _video_id(url):
        match = VIDEO_ID_RE.search(url)
        return match.group(1) if match else None

    def resolve(self, url):
        video_id = self._video_id(url)
        with self.lock:
            if video_id and video_id in self.cache:
                entry = self.cache[video_id]
                if entry["expire_ts"] > time.time():
                    return {
                        "url": entry["url"],
                        "id": video_id,
                        "format_id": entry["format_id"],
                        "cached": True,
                    }
                del self.cache[video_id]
            try:
                info = self.ydl.extract_info(url, download=False)
                if not info.get("url"):
                    return {"error": "no playable audio format found"}
                self._cache(video_id, info)
                return {
                    "url": info["url"],
                    "id": info.get("id"),
                    "format_id": info.get("format_id"),
                }
            except Exception as error:
                return {"error": str(error)}

    def _cache(self, video_id, info):
        if not video_id or not info.get("url"):
            return
        expire_ts = info.get("expires") or (time.time() + 6 * 3600)
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
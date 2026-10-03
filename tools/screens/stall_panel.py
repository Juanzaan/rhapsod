import base64, json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "Basic " + base64.b64encode(b"admin:demo-password").decode()
PAGE = ("<!doctype html><meta charset=utf-8><title>Panel de prueba</title><body style='font:20px Segoe UI;background:#101820;color:#eee;padding:40px'><h1>Panel de prueba</h1><p>" + "relleno " * 5000 + "</p></body>").encode()
stalls = [0]
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        with open("panel.log", "a") as f:
            f.write("%s %s\n" % (time.strftime("%H:%M:%S"), a[0] % a[1:]))
    def do_GET(self):
        if self.headers.get("Authorization") != TOKEN:
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Rhapsod"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path.startswith("/api/state"):
            body = json.dumps({"connected": True, "playerState": "playing", "currentTitle": "Daft Punk - Get Lucky"}).encode()
            ctype = "application/json"
            with lock:
                stall = stalls[0] < 2
                stalls[0] += 1
            if stall:
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.flush()
                self.log_message("STALLED %s", self.path)
                time.sleep(60)
                return
        else:
            body = PAGE
            ctype = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

ThreadingHTTPServer(("127.0.0.1", 8081), Handler).serve_forever()

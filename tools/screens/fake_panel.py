import base64, json
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = "Basic " + base64.b64encode(b"admin:demo-password").decode()
PAGE = """<!doctype html><meta charset=utf-8><title>Rhapsod (panel de prueba)</title>
<body style="font:20px Segoe UI;background:#101820;color:#eee;padding:40px">
<h1>Panel de prueba</h1><p>Este servidor simula el panel de Rhapsod para la captura.</p>
<p>Sonando: Daft Punk - Get Lucky</p></body>"""

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("Authorization") != TOKEN:
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Rhapsod"')
            self.end_headers()
            return
        if self.path.startswith("/api/state"):
            body = json.dumps({"connected": True, "playerState": "playing", "currentTitle": "Daft Punk - Get Lucky"}).encode()
            ctype = "application/json"
        else:
            body = PAGE.encode()
            ctype = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("127.0.0.1", 8081), Handler).serve_forever()

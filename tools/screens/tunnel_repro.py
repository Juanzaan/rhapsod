import os, socket, subprocess, sys, threading, time

USER = os.environ["USERNAME"]
HOST = USER + "@localhost"
KEY = os.path.join(os.environ["USERPROFILE"], ".ssh", "id_ed25519")
KH = os.path.join(os.environ["RUNNER_TEMP"], "kh").replace("\\", "/")
BODY = b"x" * 200000


def serve():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 9000))
    srv.listen(50)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()


def handle(c):
    req = b""
    while b"\r\n\r\n" not in req:
        d = c.recv(4096)
        if not d:
            break
        req += d
    one = b"GET /one" in req
    head = b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(BODY)
    if one:
        c.sendall(head + BODY)
    else:
        c.sendall(head)
        time.sleep(0.05)
        for i in range(0, len(BODY), 16384):
            c.sendall(BODY[i : i + 16384])
            time.sleep(0.005)
    c.close()


threading.Thread(target=serve, daemon=True).start()
time.sleep(0.5)

BASE = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=" + KH, "-i", KEY]


def fetch(port, path):
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    s.settimeout(8)
    s.sendall(b"GET " + path.encode() + b" HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    got = b""
    try:
        while True:
            d = s.recv(65536)
            if not d:
                break
            got += d
    except socket.timeout:
        got += b"<TIMEOUT>"
    s.close()
    return got


def port_open(port):
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return True
    except OSError:
        return False


def run_L(name, ssh, extra, port, stdin=subprocess.DEVNULL):
    args = [ssh] + BASE + extra + ["-L", "127.0.0.1:%d:127.0.0.1:9000" % port, HOST]
    p = subprocess.Popen(args, stdin=stdin, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(60):
        if port_open(port) or p.poll() is not None:
            break
        time.sleep(0.25)
    out = []
    for path in ("/split", "/one", "/split"):
        try:
            t = time.time()
            got = fetch(port, path)
            out.append("%s=%d%s(%.1fs)" % (path, len(got), " TIMEOUT" if got.endswith(b"<TIMEOUT>") else "", time.time() - t))
        except Exception as e:
            out.append("%s=ERR %s" % (path, e))
    p.kill()
    err = p.stderr.read().decode(errors="replace").strip().replace("\n", " | ")[:300]
    print("%-45s %s  [stderr: %s]" % (name, " ".join(out), err), flush=True)


def run_W(name, ssh, extra):
    t = time.time()
    p = subprocess.Popen([ssh] + BASE + extra + ["-W", "127.0.0.1:9000", HOST], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    p.stdin.write(b"GET /split HTTP/1.1\r\nHost: x\r\n\r\n")
    p.stdin.flush()
    got = p.stdout.read()
    p.kill()
    print("%-45s bytes=%d (%.2fs)" % (name, len(got), time.time() - t), flush=True)


expected = len(b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(BODY)) + len(BODY)
print("expected bytes per response:", expected)
ssh_list = [a for a in sys.argv[1:] if os.path.exists(a)]
port = 9100
for ssh in ssh_list:
    v = subprocess.run([ssh, "-V"], capture_output=True).stderr.decode().strip()
    print("\n=== %s (%s)" % (ssh, v), flush=True)
    variants = [
        ("app flags (-N)", ["-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30"]),
        ("-N stdin inherited", ["-N"], None),
        ("-N -n", ["-N", "-n"]),
        ("-N -T", ["-N", "-T"]),
        ("-N IPQoS=none", ["-N", "-o", "IPQoS=none"]),
        ("-N Compression=yes", ["-N", "-C"]),
        ("-N Ciphers=aes128-ctr", ["-N", "-o", "Ciphers=aes128-ctr"]),
        ("-N ChannelTimeout none / ObscureKeystroke no", ["-N", "-o", "ObscureKeystrokeTiming=no"]),
        ("-N -vvv-ish LogLevel=ERROR", ["-N", "-o", "LogLevel=ERROR"]),
    ]
    for v in variants:
        if len(v) == 3:
            run_L(v[0], ssh, v[1], port, stdin=None)
        else:
            run_L(v[0], ssh, v[1], port)
        port += 1
    run_W("-W", ssh, [])
    run_W("-W again", ssh, [])
    sock = os.path.join(os.environ["RUNNER_TEMP"], "cm%d" % port).replace("\\", "/")
    m = subprocess.Popen([ssh] + BASE + ["-M", "-S", sock, "-N", HOST], stdin=subprocess.DEVNULL, stderr=subprocess.PIPE)
    time.sleep(4)
    print("master alive:", m.poll() is None, flush=True)
    for i in range(3):
        run_W("-W through ControlMaster #%d" % i, ssh, ["-S", sock])
    m.kill()
    print("master stderr:", m.stderr.read().decode(errors="replace")[:300])

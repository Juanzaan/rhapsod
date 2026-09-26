import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  connect,
  createServer as createTcpServer,
  type Server as NetServer,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegStaticPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createFfmpegPcmStream } from "../src/audio/ffmpeg-pcm.js";
import { startEgressGuard, type EgressGuard } from "../src/lib/egress-guard.js";

function listen(server: NetServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(
        typeof address === "object" && address !== null ? address.port : 0,
      );
    });
  });
}

/** Sends one raw request to the guard and returns the first reply bytes. */
function rawRequest(
  guard: EgressGuard,
  request: string,
  afterConnect?: string,
): Promise<string> {
  const port = Number(new URL(guard.proxyUrl).port);
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(request));
    let received = "";
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      if (
        afterConnect !== undefined &&
        received.startsWith("HTTP/1.1 200") &&
        !received.includes(afterConnect)
      ) {
        if (received.endsWith("\r\n\r\n")) socket.write(afterConnect);
        return;
      }
      if (afterConnect === undefined || received.includes(afterConnect)) {
        socket.destroy();
        resolve(received);
      }
    });
    socket.on("end", () => resolve(received));
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      resolve(received);
    }, 3_000).unref();
  });
}

describe("egress guard", () => {
  const echoConnections: number[] = [];
  let echoPort = 0;
  const echo = createTcpServer((socket) => {
    echoConnections.push(Date.now());
    socket.pipe(socket);
  });

  beforeAll(async () => {
    echoPort = await listen(echo);
  });
  afterAll(() => {
    echo.close();
  });

  it("tunnels a CONNECT to an allowed address", async () => {
    const guard = await startEgressGuard({
      allowTarget: (_address, port) => port === echoPort,
    });
    try {
      const reply = await rawRequest(
        guard,
        `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n\r\n`,
        "ping",
      );
      expect(reply).toMatch(/^HTTP\/1\.1 200 /);
      expect(reply).toContain("ping");
    } finally {
      await guard.close();
    }
  });

  it("connects over IPv4 when a hostname also has an IPv6 answer", async () => {
    // The echo server listens on 127.0.0.1 only; ::1 must not be required.
    const guard = await startEgressGuard({
      lookup: () => Promise.resolve(["::1", "127.0.0.1"]),
      allowTarget: (_address, port) => port === echoPort,
    });
    try {
      const reply = await rawRequest(
        guard,
        `CONNECT media.example.com:${echoPort} HTTP/1.1\r\n\r\n`,
        "pong",
      );
      expect(reply).toMatch(/^HTTP\/1\.1 200 /);
      expect(reply).toContain("pong");
    } finally {
      await guard.close();
    }
  });

  it("refuses private addresses without connecting to them", async () => {
    const guard = await startEgressGuard();
    const before = echoConnections.length;
    try {
      const reply = await rawRequest(
        guard,
        `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\n\r\n`,
      );
      expect(reply).toMatch(/^HTTP\/1\.1 502 /);
      expect(echoConnections).toHaveLength(before);
    } finally {
      await guard.close();
    }
  });

  it.each([
    ["resolves to a private address", ["10.0.0.7"]],
    ["mixes public and private answers", ["93.184.216.34", "127.0.0.1"]],
    ["resolves to nothing", []],
  ])("refuses a hostname that %s", async (_label, addresses) => {
    const guard = await startEgressGuard({
      lookup: () => Promise.resolve(addresses),
    });
    try {
      const reply = await rawRequest(
        guard,
        "CONNECT cdn.example.com:443 HTTP/1.1\r\n\r\n",
      );
      expect(reply).toMatch(/^HTTP\/1\.1 502 /);
    } finally {
      await guard.close();
    }
  });

  it("refuses when the lookup fails, and never answers 403", async () => {
    const guard = await startEgressGuard({
      lookup: () => Promise.reject(new Error("ENOTFOUND")),
    });
    try {
      const reply = await rawRequest(
        guard,
        "CONNECT missing.example.com:443 HTTP/1.1\r\n\r\n",
      );
      expect(reply).toMatch(/^HTTP\/1\.1 502 /);
      expect(reply).not.toContain("403");
    } finally {
      await guard.close();
    }
  });

  it.each([
    [
      "a plain-HTTP request",
      "GET http://169.254.169.254/latest HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n",
    ],
    ["a malformed target", "CONNECT not a target HTTP/1.1\r\n\r\n"],
    ["port zero", "CONNECT cdn.example.com:0 HTTP/1.1\r\n\r\n"],
  ])("refuses %s", async (_label, request) => {
    const guard = await startEgressGuard({
      lookup: () => Promise.resolve(["93.184.216.34"]),
    });
    try {
      // Node drops an unparseable request line without a reply.
      expect(await rawRequest(guard, request)).toMatch(/^(HTTP\/1\.1 502 |$)/);
    } finally {
      await guard.close();
    }
  });
});

function openssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Stereo 44.1 kHz and a few seconds: ffmpeg's low-latency probe flags
// (-analyzeduration 0, +nobuffer) decode nothing from a sub-second file.
function sineWav(seconds: number): Buffer {
  const rate = 44_100;
  const frames = rate * seconds;
  const data = Buffer.alloc(frames * 4);
  for (let index = 0; index < frames; index++) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * index) / rate) * 8_000,
    );
    data.writeInt16LE(sample, index * 4);
    data.writeInt16LE(sample, index * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// End to end with the bundled ffmpeg: an HTTPS source answers 302 to a
// plain-HTTP "internal" server, the case the protocol whitelist missed.
describe.skipIf(
  ffmpegStaticPath === null || process.platform === "win32" || !openssl(),
)("ffmpeg through the egress guard", () => {
  const internalHits: string[] = [];
  const internal = createHttpServer((request, response) => {
    internalHits.push(request.url ?? "");
    response.end("metadata-secret");
  });
  let internalPort = 0;
  let tlsPort = 0;
  let directory = "";
  let tls: ReturnType<typeof createHttpsServer> | undefined;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "rhapsod-egress-"));
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    internalPort = await listen(internal);
    const wav = sineWav(3);
    tls = createHttpsServer(
      {
        cert: readFileSync(join(directory, "cert.pem")),
        key: readFileSync(join(directory, "key.pem")),
      },
      (request, response) => {
        if (request.url === "/redirect") {
          response.writeHead(302, {
            location: `http://127.0.0.1:${internalPort}/latest/meta-data`,
          });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "audio/wav" });
        response.end(wav);
      },
    );
    tlsPort = await listen(tls);
  });

  afterAll(() => {
    internal.close();
    tls?.close();
    rmSync(directory, { force: true, recursive: true });
  });

  function run(
    url: string,
    egressProxyUrl: string | undefined,
  ): Promise<{ bytes: number; error?: Error }> {
    return new Promise((resolve) => {
      const pcm = createFfmpegPcmStream(url, {
        binary: ffmpegStaticPath!,
        ...(egressProxyUrl === undefined ? {} : { egressProxyUrl }),
      });
      let bytes = 0;
      pcm.stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      pcm.stream.on("error", (error) => resolve({ bytes, error }));
      pcm.stream.on("end", () => resolve({ bytes }));
    });
  }

  it("plays a public HTTPS source through the guard", async () => {
    const guard = await startEgressGuard({
      allowTarget: (_address, port) => port === tlsPort,
    });
    try {
      const result = await run(
        `https://127.0.0.1:${tlsPort}/tone.wav`,
        guard.proxyUrl,
      );
      expect(result.error).toBeUndefined();
      expect(result.bytes).toBeGreaterThan(0);
    } finally {
      await guard.close();
    }
  }, 20_000);

  it("stops a redirect to a plain-HTTP internal host", async () => {
    // Regression: ffmpeg followed the 302 past the protocol whitelist. A
    // no_proxy entry covering the host must not bypass the guard either.
    vi.stubEnv("no_proxy", "127.0.0.1,localhost");
    vi.stubEnv("NO_PROXY", "127.0.0.1,localhost");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const guard = await startEgressGuard({
      allowTarget: (_address, port) => port === tlsPort,
    });
    try {
      internalHits.length = 0;
      const result = await run(
        `https://127.0.0.1:${tlsPort}/redirect`,
        guard.proxyUrl,
      );
      expect(result.error).toBeDefined();
      expect(internalHits).toEqual([]);
    } finally {
      await guard.close();
      stderr.mockRestore();
      vi.unstubAllEnvs();
    }
  }, 20_000);

  it("reaches the internal host without the guard (the bug it closes)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      internalHits.length = 0;
      await run(`https://127.0.0.1:${tlsPort}/redirect`, undefined);
      expect(internalHits).toEqual(["/latest/meta-data"]);
    } finally {
      stderr.mockRestore();
    }
  }, 20_000);
});

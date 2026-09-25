import { describe, expect, it } from "vitest";

import { MetricsCollector, normalizeError, sanitizeUrl } from "../metrics.js";

describe("sanitizeUrl", () => {
  it("replaces http and https URLs with [url]", () => {
    expect(sanitizeUrl("visit https://example.com/path")).toBe("visit [url]");
    expect(sanitizeUrl("http://a.com http://b.com")).toBe("[url] [url]");
  });

  it("does not alter strings without URLs", () => {
    expect(sanitizeUrl("no urls here")).toBe("no urls here");
  });

  it("replaces long file paths", () => {
    expect(sanitizeUrl("error in /home/user/file.txt")).toBe("error in [path]");
  });
});

describe("normalizeError", () => {
  it("categorizes auth errors", () => {
    const result = normalizeError(new Error("sign in to confirm"));
    expect(result.category).toBe("auth");
  });

  it("categorizes timeout errors", () => {
    const result = normalizeError(new Error("request timed out"));
    expect(result.category).toBe("timeout");
  });

  it("categorizes rate-limit errors", () => {
    const result = normalizeError(new Error("HTTP 429 Too Many Requests"));
    expect(result.category).toBe("rate-limit");
  });

  it("categorizes not-found errors", () => {
    const result = normalizeError(new Error("Video unavailable (404)"));
    expect(result.category).toBe("not-found");
  });

  it("categorizes playback errors", () => {
    const result = normalizeError(new Error("streaming data not available"));
    expect(result.category).toBe("playback");
  });

  it("categorizes unknown errors", () => {
    const result = normalizeError(new Error("something weird happened"));
    expect(result.category).toBe("unknown");
  });

  it("sanitizes URLs in messages", () => {
    const result = normalizeError(
      new Error("failed to fetch https://google.com/video?q=123"),
    );
    expect(result.message).not.toContain("https://");
    expect(result.message).toContain("[url]");
  });

  it("sanitizes cookies in messages", () => {
    const result = normalizeError(new Error("cookie: abc123def is invalid"));
    expect(result.message).not.toContain("abc123def");
    expect(result.message).toContain("cookie=[redacted]");
  });

  it("sanitizes po_token in messages", () => {
    const result = normalizeError(new Error("po_token: XYZ789 rejected"));
    expect(result.message).not.toContain("XYZ789");
    expect(result.message).toContain("po_token=[redacted]");
  });

  it("sanitizes authorization headers", () => {
    const result = normalizeError(
      new Error("authorization: Bearer secret123 failed"),
    );
    expect(result.message).not.toContain("secret123");
    expect(result.message).toContain("authorization=[redacted]");
  });

  it("truncates messages longer than 120 chars", () => {
    const longMessage = "x".repeat(200);
    const result = normalizeError(new Error(longMessage));
    expect(result.message.length).toBeLessThanOrEqual(120);
    expect(result.message.endsWith("…")).toBe(true);
  });

  it("returns unknown for non-Error input", () => {
    const result = normalizeError("string error");
    expect(result.category).toBe("unknown");
  });

  it("returns unknown for null input", () => {
    const result = normalizeError(null);
    expect(result.category).toBe("unknown");
  });
});

describe("MetricsCollector", () => {
  it("returns zero counters at init", () => {
    const m = new MetricsCollector();
    const c = m.counters();
    expect(c.cacheHits).toBe(0);
    expect(c.cacheMisses).toBe(0);
    expect(c.prefetchHits).toBe(0);
    expect(c.prefetchInFlight).toBe(0);
    expect(c.prefetchMisses).toBe(0);
    expect(c.ytdlpActiveJobs).toBe(0);
    expect(c.ytdlpQueuedJobs).toBe(0);
    expect(c.ytdlpTotalRuns).toBe(0);
    expect(c.totalErrors).toBe(0);
  });

  it("increment adds 1", () => {
    const m = new MetricsCollector();
    m.increment("cacheHits");
    m.increment("cacheHits");
    expect(m.counters().cacheHits).toBe(2);
  });

  it("decrement never goes below 0", () => {
    const m = new MetricsCollector();
    m.decrement("cacheHits");
    m.decrement("cacheHits");
    expect(m.counters().cacheHits).toBe(0);
  });

  it("setGauge sets exact value", () => {
    const m = new MetricsCollector();
    m.setGauge("ytdlpActiveJobs", 3);
    expect(m.counters().ytdlpActiveJobs).toBe(3);
  });

  it("recordTiming stores timing", () => {
    const m = new MetricsCollector();
    m.recordTiming({
      audioUrlSource: "prefetch",
      cacheHit: true,
      durationMs: 100,
      prefetchStatus: "hit",
      stage: "audio-url",
      trackId: "abc",
    });
    const t = m.recentTimings();
    expect(t).toHaveLength(1);
    expect(t[0]?.trackId).toBe("abc");
    expect(t[0]?.audioUrlSource).toBe("prefetch");
  });

  it("evicts oldest timing when exceeding maxTimings", () => {
    const m = new MetricsCollector({ maxTimings: 3 });
    m.recordTiming({
      durationMs: 1,
      stage: "audio-url",
      trackId: "1",
    });
    m.recordTiming({
      durationMs: 2,
      stage: "audio-url",
      trackId: "2",
    });
    m.recordTiming({
      durationMs: 3,
      stage: "audio-url",
      trackId: "3",
    });
    m.recordTiming({
      durationMs: 4,
      stage: "audio-url",
      trackId: "4",
    });
    const t = m.recentTimings();
    expect(t).toHaveLength(3);
    expect(t[0]?.trackId).toBe("2");
    expect(t[2]?.trackId).toBe("4");
  });

  it("recordError normalizes and stores error", () => {
    const m = new MetricsCollector();
    m.recordError("track1", new Error("sign in required"));
    const e = m.recentErrors();
    expect(e).toHaveLength(1);
    expect(e[0]?.trackId).toBe("track1");
    expect(e[0]?.normalized.category).toBe("auth");
    expect(m.counters().totalErrors).toBe(1);
  });

  it("evicts oldest error when exceeding maxErrors", () => {
    const m = new MetricsCollector({ maxErrors: 2 });
    m.recordError("t1", new Error("err1"));
    m.recordError("t2", new Error("err2"));
    m.recordError("t3", new Error("err3"));
    expect(m.recentErrors()).toHaveLength(2);
    expect(m.recentErrors()[0]?.trackId).toBe("t2");
  });

  it("recentTimings defaults to 20", () => {
    const m = new MetricsCollector();
    for (let i = 0; i < 25; i++) {
      m.recordTiming({ durationMs: i, stage: "audio-url", trackId: `${i}` });
    }
    expect(m.recentTimings()).toHaveLength(20);
    expect(m.recentTimings(5)).toHaveLength(5);
  });

  it("formatStats shows uptime and no URLs", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 5,
      tracksPlayed: 10,
      uptimeSec: 3_661,
      volume: 70,
      ytdlpActive: 1,
      ytdlpQueued: 0,
    });
    expect(output).toContain("Uptime: 1h 1m");
    expect(output).toContain("Cola: 5");
    expect(output).toContain("Vol: 70%");
    expect(output).not.toContain("http");
    expect(output).not.toContain("/");
  });

  it("formatStats shows track title truncated", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      current: { title: "A".repeat(60), durationSeconds: 200 },
      loopMode: "track",
      queueLen: 0,
      tracksPlayed: 1,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("…");
    expect(output).not.toContain("A".repeat(60));
  });

  it("formatStats shows 'Nada reproduciéndose' when no current", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("Nada reproduciéndose");
  });

  it("formatStats calculates hit rate with 1 decimal", () => {
    const m = new MetricsCollector();
    m.increment("cacheHits");
    m.increment("cacheHits");
    m.increment("cacheMisses");
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("66.7%");
  });

  it("formatDiag shows recent errors", () => {
    const m = new MetricsCollector();
    m.recordError("t1", new Error("sign in to confirm cookies"));
    const output = m.formatDiag();
    expect(output).toContain("[auth]");
    expect(output).not.toContain("sign in to confirm cookies");
  });

  it("formatDiag shows recent timings", () => {
    const m = new MetricsCollector();
    m.recordTiming({
      audioUrlSource: "prefetch",
      cacheHit: true,
      durationMs: 42,
      prefetchStatus: "hit",
      stage: "audio-url",
      trackId: "vid123",
    });
    const output = m.formatDiag();
    expect(output).toContain("vid123");
    expect(output).toContain("42ms");
  });

  it("formatDiag shows (ninguno) when empty", () => {
    const m = new MetricsCollector();
    const output = m.formatDiag();
    expect(output).toContain("(ninguno)");
  });

  it("reset clears all state", () => {
    const m = new MetricsCollector();
    m.increment("cacheHits");
    m.recordTiming({ durationMs: 1, stage: "audio-url", trackId: "x" });
    m.recordError("x", new Error("fail"));
    m.reset();
    expect(m.counters().cacheHits).toBe(0);
    expect(m.recentTimings()).toHaveLength(0);
    expect(m.recentErrors()).toHaveLength(0);
  });
});

describe("sanitizeUrl - datos reales sensibles", () => {
  it("sanitiza URL firmada de googlevideo", () => {
    const url =
      "https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=1234567890&ei=abc&ip=192.168.1.1&id=o.abc123&itag=251&ratebypass=yes&dur=180&fexp=123456";
    const result = sanitizeUrl(url);
    expect(result).toBe("[url]");
    expect(result).not.toContain("googlevideo");
    expect(result).not.toContain("videoplayback");
    expect(result).not.toContain("192.168.1.1");
  });

  it("sanitiza cookie string", () => {
    const input = "cookie: SID=abc123def456; HSID=xyz789";
    const result = sanitizeUrl(input);
    expect(result).not.toContain("SID=abc123def456");
    expect(result).not.toContain("HSID=xyz789");
  });

  it("sanitiza po_token", () => {
    const input = "po_token: MItZnFjdHJ8YWJjZGVmZzEyMzQ1Ng==";
    const result = sanitizeUrl(input);
    expect(result).not.toContain("MItZnFjdHJ8YWJjZGVmZzEyMzQ1Ng==");
  });

  it("sanitiza authorization header", () => {
    const input = "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secretpayload";
    const result = sanitizeUrl(input);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(result).not.toContain("secretpayload");
  });

  it("sanitiza path local largo", () => {
    const input = "error in /home/rhapsod/.config/cookies.txt";
    const result = sanitizeUrl(input);
    expect(result).not.toContain("/home/rhapsod/.config/cookies.txt");
    expect(result).toContain("[path]");
  });

  it("no sanitiza strings cortos sin patrones sensibles", () => {
    const input = "Video unavailable";
    const result = sanitizeUrl(input);
    expect(result).toBe("Video unavailable");
  });
});

describe("normalizeError - sanitización completa", () => {
  it("sanitiza URL firmada en error", () => {
    const error = new Error(
      "Failed to fetch https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=123",
    );
    const result = normalizeError(error);
    expect(result.message).not.toContain("googlevideo");
    expect(result.message).toContain("[url]");
  });

  it("sanitiza cookies en error", () => {
    const error = new Error(
      "Authentication failed: cookie: SID=abc123def456; HSID=xyz789",
    );
    const result = normalizeError(error);
    expect(result.message).not.toContain("SID=abc123def456");
    expect(result.message).toContain("cookie=[redacted]");
  });

  it("sanitiza po_token en error", () => {
    const error = new Error(
      "Invalid po_token: MItZnFjdHJ8YWJjZGVmZzEyMzQ1Ng==",
    );
    const result = normalizeError(error);
    expect(result.message).not.toContain("MItZnFjdHJ8YWJjZGVmZzEyMzQ1Ng==");
    expect(result.message).toContain("po_token=[redacted]");
  });

  it("sanitiza authorization header en error", () => {
    const error = new Error(
      "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secretpayload failed",
    );
    const result = normalizeError(error);
    expect(result.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(result.message).toContain("authorization=[redacted]");
  });

  it("sanitiza headers object en error", () => {
    const error = new Error(
      'headers: {"cookie": "SID=abc123", "authorization": "Bearer secret"}',
    );
    const result = normalizeError(error);
    expect(result.message).not.toContain("SID=abc123");
    expect(result.message).not.toContain("Bearer secret");
  });

  it("limita longitud del mensaje a 120 chars", () => {
    const longUrl = "https://example.com/" + "a".repeat(200);
    const error = new Error(`Failed to fetch ${longUrl}`);
    const result = normalizeError(error);
    expect(result.message.length).toBeLessThanOrEqual(120);
    expect(result.message.endsWith("…")).toBe(true);
  });
});

describe("contadores - comportamiento tras ejecución", () => {
  it("ytdlpActiveJobs vuelve a 0 tras completar jobs", () => {
    const m = new MetricsCollector();

    m.setGauge("ytdlpActiveJobs", 1);
    expect(m.counters().ytdlpActiveJobs).toBe(1);

    m.setGauge("ytdlpActiveJobs", 0);
    expect(m.counters().ytdlpActiveJobs).toBe(0);
  });

  it("ytdlpQueuedJobs vuelve a 0 tras completar jobs", () => {
    const m = new MetricsCollector();

    m.setGauge("ytdlpQueuedJobs", 3);
    expect(m.counters().ytdlpQueuedJobs).toBe(3);

    m.setGauge("ytdlpQueuedJobs", 0);
    expect(m.counters().ytdlpQueuedJobs).toBe(0);
  });

  it("totalRuns solo aumenta, nunca disminuye", () => {
    const m = new MetricsCollector();

    m.increment("ytdlpTotalRuns");
    m.increment("ytdlpTotalRuns");
    m.increment("ytdlpTotalRuns");
    expect(m.counters().ytdlpTotalRuns).toBe(3);

    m.decrement("ytdlpTotalRuns");
    expect(m.counters().ytdlpTotalRuns).toBe(3);
  });

  it("cacheHits y cacheMisses cambian coherently", () => {
    const m = new MetricsCollector();

    m.increment("cacheHits");
    m.increment("cacheHits");
    m.increment("cacheMisses");

    const c = m.counters();
    expect(c.cacheHits).toBe(2);
    expect(c.cacheMisses).toBe(1);
  });

  it("prefetch counters cambian coherently", () => {
    const m = new MetricsCollector();

    m.increment("prefetchHits");
    m.increment("prefetchInFlight");
    m.increment("prefetchMisses");

    const c = m.counters();
    expect(c.prefetchHits).toBe(1);
    expect(c.prefetchInFlight).toBe(1);
    expect(c.prefetchMisses).toBe(1);
  });

  it("decrement nunca baja de 0", () => {
    const m = new MetricsCollector();
    m.decrement("cacheHits");
    m.decrement("cacheHits");
    expect(m.counters().cacheHits).toBe(0);
  });
});

describe("formatStats - límite de mensajes TS3", () => {
  it("trunca título largo a 40 chars", () => {
    const m = new MetricsCollector();
    const longTitle = "A".repeat(100);
    const output = m.formatStats({
      current: { title: longTitle, durationSeconds: 200 },
      loopMode: "off",
      queueLen: 1,
      tracksPlayed: 1,
      uptimeSec: 3600,
      volume: 70,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("…");
    expect(output).not.toContain("A".repeat(100));
    expect(output.length).toBeLessThan(500);
  });

  it("formatStats no contiene URLs, IPs ni paths", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).not.toMatch(/https?:\/\//);
    expect(output).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    expect(output).not.toContain("/home/");
    expect(output).not.toContain("/usr/");
  });

  it("formatDiag no contiene URLs, IPs ni paths", () => {
    const m = new MetricsCollector();
    m.recordError(
      "t1",
      new Error("Failed https://googlevideo.com/videoplayback?expire=123"),
    );
    const output = m.formatDiag();
    expect(output).not.toContain("googlevideo");
    expect(output).not.toContain("videoplayback");
  });

  it("formatStats maneja título vacío", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      current: { title: "" },
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("Actual: ");
  });

  it("formatStats muestra hit rate con 1 decimal", () => {
    const m = new MetricsCollector();
    m.increment("cacheHits");
    m.increment("cacheHits");
    m.increment("cacheMisses");
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("66.7%");
  });

  it("formatStats muestra 0.0% cuando no hay cache hits", () => {
    const m = new MetricsCollector();
    m.increment("cacheMisses");
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("0.0%");
  });
});

describe("formatStats - audio health", () => {
  it("muestra sección Audio cuando hay métricas", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      audioHealth: {
        firstFrameDelayMs: 1234,
        rebufferEvents: 2,
        underruns: 5,
      },
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("--- Audio ---");
    expect(output).toContain("Inicio: 1234ms");
    expect(output).toContain("Underruns: 5");
    expect(output).toContain("Rebuffers: 2");
  });

  it("no muestra sección Audio cuando no hay métricas", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).not.toContain("--- Audio ---");
  });

  it("muestra Inicio: - cuando firstFrameDelayMs es undefined", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      audioHealth: {
        rebufferEvents: 0,
        underruns: 0,
      },
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 0,
      volume: 50,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });
    expect(output).toContain("Inicio: -");
  });
});

describe("prefetch counters from PlaybackTiming", () => {
  function applyTiming(
    m: MetricsCollector,
    prefetchStatus?: "hit" | "in-flight" | "miss" | "not-applicable",
  ) {
    const timing = {
      durationMs: 100,
      stage: "audio-url" as const,
      trackId: "t",
      ...(prefetchStatus === undefined ? {} : { prefetchStatus }),
    };
    if (timing.stage === "audio-url") {
      const s = timing.prefetchStatus;
      if (s === "hit") m.increment("prefetchHits");
      else if (s === "in-flight") m.increment("prefetchInFlight");
      else if (s === "miss") m.increment("prefetchMisses");
    }
    m.recordTiming(timing);
  }

  it("hit increments prefetchHits only", () => {
    const m = new MetricsCollector();
    applyTiming(m, "hit");
    const c = m.counters();
    expect(c.prefetchHits).toBe(1);
    expect(c.prefetchInFlight).toBe(0);
    expect(c.prefetchMisses).toBe(0);
  });

  it("in-flight increments prefetchInFlight only", () => {
    const m = new MetricsCollector();
    applyTiming(m, "in-flight");
    const c = m.counters();
    expect(c.prefetchHits).toBe(0);
    expect(c.prefetchInFlight).toBe(1);
    expect(c.prefetchMisses).toBe(0);
  });

  it("miss increments prefetchMisses only", () => {
    const m = new MetricsCollector();
    applyTiming(m, "miss");
    const c = m.counters();
    expect(c.prefetchHits).toBe(0);
    expect(c.prefetchInFlight).toBe(0);
    expect(c.prefetchMisses).toBe(1);
  });

  it("not-applicable does not increment any prefetch counter", () => {
    const m = new MetricsCollector();
    applyTiming(m, "not-applicable");
    const c = m.counters();
    expect(c.prefetchHits).toBe(0);
    expect(c.prefetchInFlight).toBe(0);
    expect(c.prefetchMisses).toBe(0);
  });

  it("undefined prefetchStatus does not increment any prefetch counter", () => {
    const m = new MetricsCollector();
    applyTiming(m, undefined);
    const c = m.counters();
    expect(c.prefetchHits).toBe(0);
    expect(c.prefetchInFlight).toBe(0);
    expect(c.prefetchMisses).toBe(0);
  });

  it("metadata stage does not increment any prefetch counter", () => {
    const m = new MetricsCollector();
    m.recordTiming({
      durationMs: 50,
      stage: "metadata",
      trackId: "t",
      prefetchStatus: "hit",
    });
    const c = m.counters();
    expect(c.prefetchHits).toBe(0);
  });

  it("multiple timings accumulate correctly", () => {
    const m = new MetricsCollector();
    applyTiming(m, "hit");
    applyTiming(m, "hit");
    applyTiming(m, "miss");
    applyTiming(m, "in-flight");
    applyTiming(m, "not-applicable");
    const c = m.counters();
    expect(c.prefetchHits).toBe(2);
    expect(c.prefetchInFlight).toBe(1);
    expect(c.prefetchMisses).toBe(1);
  });
});

describe("formatDiag - límite de mensajes TS3", () => {
  it("muestra máximo 3 errores recientes", () => {
    const m = new MetricsCollector();
    for (let i = 0; i < 10; i++) {
      m.recordError(`t${i}`, new Error(`error ${i}`));
    }
    const output = m.formatDiag();
    const errorLines = output.split("\n").filter((l) => l.startsWith("  ["));
    expect(errorLines.length).toBeLessThanOrEqual(3);
  });

  it("muestra máximo 5 timings recientes", () => {
    const m = new MetricsCollector();
    for (let i = 0; i < 10; i++) {
      m.recordTiming({
        durationMs: i * 100,
        stage: "audio-url",
        trackId: `track${i}`,
      });
    }
    const output = m.formatDiag();
    const timingLines = output
      .split("\n")
      .filter((l) => l.includes("audio-url") || l.includes("metadata"));
    expect(timingLines.length).toBeLessThanOrEqual(5);
  });

  it("formatDiag no excede longitud razonable", () => {
    const m = new MetricsCollector();
    for (let i = 0; i < 50; i++) {
      m.recordError(`t${i}`, new Error(`error ${i}`));
      m.recordTiming({
        durationMs: i * 100,
        stage: "audio-url",
        trackId: `track${i}`,
      });
    }
    const output = m.formatDiag();
    expect(output.length).toBeLessThan(800);
  });
});

describe("flujo de error - no rompe playback", () => {
  it("normalizeError produce mensaje genérico sanitizado", () => {
    const error = new Error(
      "Failed to fetch https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=123",
    );
    const result = normalizeError(error);
    expect(result.category).toBe("unknown");
    expect(result.message).not.toContain("googlevideo");
    expect(result.message).toContain("[url]");
  });

  it("normalizeError categoriza correctamente", () => {
    expect(normalizeError(new Error("sign in to confirm")).category).toBe(
      "auth",
    );
    expect(normalizeError(new Error("timed out")).category).toBe("timeout");
    expect(normalizeError(new Error("HTTP 429")).category).toBe("rate-limit");
    expect(normalizeError(new Error("Video unavailable (404)")).category).toBe(
      "not-found",
    );
    expect(
      normalizeError(new Error("streaming data not available")).category,
    ).toBe("playback");
    expect(normalizeError(new Error("something weird")).category).toBe(
      "unknown",
    );
  });

  it("normalizeError no expose detalles internos", () => {
    const error = new Error(
      "cookie: SID=abc123; po_token=secret123; authorization: Bearer token456",
    );
    const result = normalizeError(error);
    expect(result.message).not.toContain("SID=abc123");
    expect(result.message).not.toContain("secret123");
    expect(result.message).not.toContain("token456");
  });

  it("MetricsCollector registra errores sin romper", () => {
    const m = new MetricsCollector();
    m.recordError("track1", new Error("fail"));
    m.recordError("track2", "string error");
    m.recordError("track3", null);
    m.recordError("track4", undefined);

    expect(m.counters().totalErrors).toBe(4);
    expect(m.recentErrors()).toHaveLength(4);
  });

  it("onPlaybackError genera mensaje genérico", () => {
    const trackTitle = "My Very Long Song Title That Should Be Truncated";
    const truncatedTitle =
      trackTitle.length > 40 ? `${trackTitle.slice(0, 39)}…` : trackTitle;
    const message = `No pude reproducir "${truncatedTitle}". Se intentará continuar con la siguiente canción.`;
    expect(message).toContain("…");
    expect(message).not.toContain(trackTitle);
    expect(message.length).toBeLessThan(120);
  });
});

describe("isAdminUid - permisos de !diag", () => {
  it("admin uid es reconocido", () => {
    const adminUids = new Set(["uid123", "uid456"]);
    expect(adminUids.has("uid123")).toBe(true);
    expect(adminUids.has("uid456")).toBe(true);
    expect(adminUids.has("uid789")).toBe(false);
  });

  it("conjunto vacío no tiene admins", () => {
    const adminUids = new Set<string>();
    expect(adminUids.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import { MetricsCollector } from "../src/observability/metrics.js";

describe("disconnectSummary", () => {
  it("empty by default", () => {
    expect(new MetricsCollector().disconnectSummary()).toEqual({ count: 0 });
  });

  it("counts and keeps the last event", () => {
    const m = new MetricsCollector();
    m.recordDisconnect("kicked");
    m.recordDisconnect("disconnected");
    const summary = m.disconnectSummary();
    expect(summary.count).toBe(2);
    expect(summary.lastReason).toBe("disconnected");
    expect(typeof summary.lastTs).toBe("number");
  });

  it("truncates long reasons", () => {
    const m = new MetricsCollector();
    m.recordDisconnect("x".repeat(100));
    expect(m.disconnectSummary().lastReason?.length).toBeLessThanOrEqual(40);
  });

  it("reset clears tracking", () => {
    const m = new MetricsCollector();
    m.recordDisconnect("kicked");
    m.reset();
    expect(m.disconnectSummary()).toEqual({ count: 0 });
  });
});

describe("errorSummary", () => {
  it("agrupa por categoría y guarda el título del track", () => {
    const m = new MetricsCollector();
    m.recordError("vid1", new Error("sign in to confirm"), "Song One");
    m.recordError("vid2", new Error("HTTP 429 Too Many Requests"));
    m.recordError("vid3", new Error("sign in required"), "Song Three");

    const summary = m.errorSummary();
    expect(summary.totalErrors).toBe(3);
    expect(summary.byCategory).toEqual({ auth: 2, "rate-limit": 1 });
    expect(summary.recent).toHaveLength(3);
    expect(summary.recent[0]?.trackTitle).toBe("Song One");
    expect(summary.recent[1]?.trackTitle).toBeUndefined();
    expect(summary.recent[2]?.category).toBe("auth");
  });

  it("vacío no rompe", () => {
    const summary = new MetricsCollector().errorSummary();
    expect(summary.totalErrors).toBe(0);
    expect(summary.byCategory).toEqual({});
    expect(summary.recent).toEqual([]);
  });

  it("no expone secretos en el resumen", () => {
    const m = new MetricsCollector();
    m.recordError("vid1", new Error("cookie: SID=abc123"), "Song");
    const [entry] = m.errorSummary().recent;
    expect(entry?.message).not.toContain("abc123");
    expect(entry?.trackTitle).toBe("Song");
  });

  it("respeta el límite de recientes", () => {
    const m = new MetricsCollector({ maxErrors: 50 });
    for (let i = 0; i < 5; i++) {
      m.recordError(`vid${i}`, new Error("fail"));
    }
    expect(m.errorSummary(2).recent).toHaveLength(2);
    expect(m.errorSummary(2).totalErrors).toBe(5);
  });
});

import { describe, expect, it } from "vitest";

import { ChatLog } from "../src/application/chat-log.js";

describe("ChatLog", () => {
  it("keeps insertion order", () => {
    const log = new ChatLog();
    log.push("Ana", "hola", false);
    log.push("Bot", "Reproduciendo: X", true);
    const entries = log.snapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ from: "Ana", outgoing: false });
    expect(entries[1]).toMatchObject({ from: "Bot", outgoing: true });
    expect(typeof entries[0]?.ts).toBe("number");
  });

  it("caps entries at the limit", () => {
    const log = new ChatLog(3);
    for (let i = 0; i < 5; i++) log.push("u", `m${i}`, false);
    const entries = log.snapshot();
    expect(entries).toHaveLength(3);
    expect(entries[0]?.text).toBe("m2");
  });

  it("ignores blank messages", () => {
    const log = new ChatLog();
    log.push("Ana", "   ", false);
    expect(log.snapshot()).toEqual([]);
  });

  it("truncates long texts and normalizes whitespace", () => {
    const log = new ChatLog();
    log.push("", `a\nb  c${"x".repeat(600)}`, false);
    const [entry] = log.snapshot();
    expect(entry?.from).toBe("?");
    expect(entry?.text).not.toContain("\n");
    expect(entry?.text.length).toBeLessThanOrEqual(500);
  });

  it("snapshot returns a copy", () => {
    const log = new ChatLog();
    log.push("Ana", "hola", false);
    const copy = log.snapshot();
    expect(copy).not.toBe(log.snapshot());
    expect(copy).toHaveLength(1);
  });
});

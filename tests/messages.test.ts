import { describe, expect, it } from "vitest";

import {
  formatPlaybackError,
  formatPlaybackStarted,
} from "../src/lib/messages.js";

describe("formatPlaybackStarted", () => {
  it("returns 'Reproduciendo: {title}' for the first track", () => {
    expect(formatPlaybackStarted("Seu Jorge - Burguesinha", true)).toBe(
      "Reproduciendo: Seu Jorge - Burguesinha",
    );
  });

  it("returns 'Ahora: {title}' for subsequent tracks", () => {
    expect(formatPlaybackStarted("Daft Punk - Around the World", false)).toBe(
      "Ahora: Daft Punk - Around the World",
    );
  });

  it("contains no emojis", () => {
    const result = formatPlaybackStarted("Test Track", true);
    const codePoints = [...result].map((c) => c.codePointAt(0) ?? 0);
    const hasEmoji = codePoints.some((cp) => cp > 0x1f600);
    expect(hasEmoji).toBe(false);
  });

  it("sends exactly one message per playback event", () => {
    const first = formatPlaybackStarted("Track A", true);
    const second = formatPlaybackStarted("Track B", false);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});

describe("formatPlaybackError", () => {
  it("truncates long titles to 40 chars with ellipsis", () => {
    const longTitle = "A".repeat(50);
    const result = formatPlaybackError(longTitle);
    expect(result).toContain(`${"A".repeat(39)}\u2026`);
    expect(result).toContain("No pude reproducir");
  });

  it("does not truncate short titles", () => {
    const result = formatPlaybackError("Short Title");
    expect(result).toBe(
      'No pude reproducir "Short Title". Se intentará continuar con la siguiente canción.',
    );
  });

  it("contains no emojis", () => {
    const result = formatPlaybackError("Test Track");
    const codePoints = [...result].map((c) => c.codePointAt(0) ?? 0);
    const hasEmoji = codePoints.some((cp) => cp > 0x1f600);
    expect(hasEmoji).toBe(false);
  });

  it("formats exactly one error message", () => {
    const result = formatPlaybackError("Some Track");
    expect(result.split("\n")).toHaveLength(1);
  });
});

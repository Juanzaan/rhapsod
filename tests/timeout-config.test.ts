import { describe, expect, it, vi } from "vitest";

import { getTimeoutConfig } from "../src/lib/timeout-config.js";

describe("getTimeoutConfig", () => {
  it("returns defaults when no env vars are set", () => {
    const config = getTimeoutConfig({});
    expect(config.search).toBe(8000);
    expect(config.audioUrl).toBe(12000);
    expect(config.download).toBe(60000);
    expect(config.metadata).toBe(30000);
    expect(config.playlist).toBe(45000);
  });

  it("respects custom env values", () => {
    const config = getTimeoutConfig({
      RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "10000",
      RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS: "15000",
    });
    expect(config.search).toBe(10000);
    expect(config.audioUrl).toBe(15000);
    expect(config.download).toBe(60000);
  });

  it("clamps values below minimum", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = getTimeoutConfig({
      RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "1000",
    });
    expect(config.search).toBe(4000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("below minimum"));
    warn.mockRestore();
  });

  it("clamps values above maximum", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = getTimeoutConfig({
      RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "50000",
    });
    expect(config.search).toBe(20000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("above maximum"));
    warn.mockRestore();
  });

  it("uses default for non-numeric values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = getTimeoutConfig({
      RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "not-a-number",
    });
    expect(config.search).toBe(8000);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid timeout"),
    );
    warn.mockRestore();
  });

  it("uses default for negative values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = getTimeoutConfig({
      RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "-5000",
    });
    expect(config.search).toBe(8000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

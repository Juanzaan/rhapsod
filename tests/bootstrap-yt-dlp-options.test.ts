import { describe, expect, it } from "vitest";

import { ytDlpStackOptions } from "../src/bootstrap/yt-dlp-options.js";
import { loadConfig } from "../src/config.js";

describe("ytDlpStackOptions", () => {
  it("passes only the yt-dlp settings that are set", () => {
    const config = loadConfig({
      RHAPSOD_TS3_HOST: "127.0.0.1",
      RHAPSOD_YTDLP_COOKIES_PATH: "/etc/rhapsod/cookies.txt",
    });
    const options = ytDlpStackOptions(config);
    expect(options.ytdlpPath).toBe("yt-dlp");
    expect(options.cookiesPath).toBe("/etc/rhapsod/cookies.txt");
    expect(options).not.toHaveProperty("daemonUrl");
    expect(options).not.toHaveProperty("extractorArgs");
    expect(options.timeouts).toBeDefined();
  });
});

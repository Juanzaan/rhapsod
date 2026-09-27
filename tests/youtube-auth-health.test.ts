import { describe, expect, it } from "vitest";

import {
  classifyYoutubeAuthFailure,
  youtubeAuthHint,
} from "../src/lib/youtube-auth-health.js";

describe("classifyYoutubeAuthFailure", () => {
  it("classifies authentication errors as cookies-invalid", () => {
    expect(
      classifyYoutubeAuthFailure(
        new Error("Sign in to confirm you're not a bot"),
      ),
    ).toBe("cookies-invalid");
    expect(classifyYoutubeAuthFailure(new Error("login required"))).toBe(
      "cookies-invalid",
    );
  });

  it("classifies bot checks as soft-block", () => {
    expect(
      classifyYoutubeAuthFailure(new Error("The page needs to be reloaded.")),
    ).toBe("soft-block");
    expect(
      classifyYoutubeAuthFailure(
        new Error("Requested format is not available"),
      ),
    ).toBe("soft-block");
  });

  it("classifies unknown failures as extraction-failed", () => {
    expect(classifyYoutubeAuthFailure(new Error("some other failure"))).toBe(
      "extraction-failed",
    );
    expect(classifyYoutubeAuthFailure("non-error value")).toBe(
      "extraction-failed",
    );
  });
});

describe("youtubeAuthHint", () => {
  it("points a blocked server without WARP at the installer flag", () => {
    const hint = youtubeAuthHint("soft-block", false);
    expect(hint).toContain("RHAPSOD_WITH_WARP=1");
    expect(hint).toContain("cookies");
  });

  it("asks for cookies when WARP is already on", () => {
    const hint = youtubeAuthHint("soft-block", true);
    expect(hint).not.toContain("RHAPSOD_WITH_WARP");
    expect(hint).toContain("cookies");
  });

  it("asks for cookies when YouTube wants a login", () => {
    expect(youtubeAuthHint("cookies-invalid", false)).toContain("cookies");
  });

  it("points at the logs for other failures", () => {
    expect(youtubeAuthHint("extraction-failed", false)).toContain("logs");
    expect(youtubeAuthHint(undefined, false)).toContain("logs");
  });
});

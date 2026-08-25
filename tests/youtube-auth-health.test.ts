import { describe, expect, it } from "vitest";

import { classifyYoutubeAuthFailure } from "../src/lib/youtube-auth-health.js";

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

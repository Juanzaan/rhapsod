import { describe, expect, it } from "vitest";

import { DrmProtectedError, isDrmError } from "../src/lib/drm-error.js";
import { SoundCloudDrmError } from "../src/media/soundcloud/public-api.js";

describe("isDrmError", () => {
  it("recognizes resolver DRM errors by type", () => {
    const error = new SoundCloudDrmError({ artist: "A", title: "T" });
    error.message = "reworded";
    expect(error).toBeInstanceOf(DrmProtectedError);
    expect(isDrmError(error)).toBe(true);
  });

  it("recognizes the DRM line yt-dlp prints", () => {
    expect(
      isDrmError(
        new Error("ERROR: [soundcloud] 123: This video is DRM protected"),
      ),
    ).toBe(true);
  });

  it("ignores other errors and non-errors", () => {
    expect(isDrmError(new Error("fetch failed"))).toBe(false);
    expect(isDrmError("DRM protected")).toBe(false);
    expect(isDrmError(undefined)).toBe(false);
  });
});

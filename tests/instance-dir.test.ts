import { sep } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveInstanceDir } from "../src/lib/instance-dir.js";

describe("resolveInstanceDir", () => {
  it("keeps the historical layout without an instance id", () => {
    expect(resolveInstanceDir("./data")).toBe("./data");
    expect(resolveInstanceDir("./data", undefined)).toBe("./data");
  });

  it("nests named instances under instances/<id>", () => {
    expect(resolveInstanceDir("data", "blue").split(sep)).toEqual([
      "data",
      "instances",
      "blue",
    ]);
    expect(resolveInstanceDir("data", "after-hours").split(sep)).toEqual([
      "data",
      "instances",
      "after-hours",
    ]);
  });
});

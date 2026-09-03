import { describe, expect, it } from "vitest";

import {
  parseProbeServerName,
  probeTs3Server,
} from "../src/adapters/ts3/probe.js";

describe("parseProbeServerName", () => {
  it("unescapes TeamSpeak query encoding", () => {
    expect(
      parseProbeServerName([{ virtualserver_name: "Holy\\sPvP\\sNet" }]),
    ).toBe("Holy PvP Net");
  });

  it("returns undefined without a name", () => {
    expect(parseProbeServerName([])).toBeUndefined();
    expect(parseProbeServerName([{ virtualserver_name: "" }])).toBeUndefined();
    expect(
      parseProbeServerName([{ virtualserver_name: "(no disponible)" }]),
    ).toBeUndefined();
  });
});

describe("probeTs3Server", () => {
  it("rejects empty host without network", async () => {
    const result = await probeTs3Server("", 9987);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/host/i);
  });

  it("rejects invalid ports without network", async () => {
    for (const port of [0, -1, 65536, Number.NaN]) {
      const result = await probeTs3Server("127.0.0.1", port);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/puerto/i);
    }
  });

  it("fails gracefully on refused connection", async () => {
    // Port 1 is virtually never open; proves timeout/refused handling.
    const result = await probeTs3Server("127.0.0.1", 1, 3_000);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

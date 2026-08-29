import { describe, expect, it } from "vitest";

import {
  isBlockedAddress,
  isPrivateHost,
  isPublicHostname,
} from "../src/lib/ssrf.js";

describe("isBlockedAddress", () => {
  it("blocks private and special-purpose IPv4 ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "100.100.100.200",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4 addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.1.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks private and special-purpose IPv6 ranges", () => {
    for (const ip of [
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "ff00::1",
      "2001:db8::1",
      "64:ff9b::1",
      "2002::1",
      "2001::1",
      "::ffff:10.0.0.1",
      "::5efe:10.0.0.1",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6 addresses", () => {
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("rejects unparseable input", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("isPrivateHost", () => {
  it("detects localhost and private literals", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });
});

describe("isPublicHostname", () => {
  it("rejects private hostnames without resolving", async () => {
    expect(await isPublicHostname("127.0.0.1")).toBe(false);
    expect(await isPublicHostname("[::1]")).toBe(false);
    expect(await isPublicHostname("localhost")).toBe(false);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    expect(await isPublicHostname("metadata.internal")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  canRemoveTrack,
  isAdminUid,
  parseAdminUids,
} from "../src/commands/permissions.js";

describe("parseAdminUids", () => {
  it("parses a comma-separated list and trims entries", () => {
    expect(parseAdminUids(" UID1, UID2 ,UID3 ")).toEqual(
      new Set(["UID1", "UID2", "UID3"]),
    );
  });

  it("returns an empty set for empty input", () => {
    expect(parseAdminUids(undefined)).toEqual(new Set());
    expect(parseAdminUids("")).toEqual(new Set());
    expect(parseAdminUids(",,")).toEqual(new Set());
  });
});

describe("isAdminUid", () => {
  const admins = new Set(["UID1"]);

  it("allows a configured admin uid", () => {
    expect(isAdminUid("UID1", admins)).toBe(true);
  });

  it("rejects everyone when no admins are configured", () => {
    expect(isAdminUid("UID1", new Set())).toBe(false);
  });

  it("rejects non-admin uids", () => {
    expect(isAdminUid("other", admins)).toBe(false);
  });
});

describe("canRemoveTrack", () => {
  const adminUids = new Set(["admin-uid"]);

  it("allows admins to remove any track", () => {
    expect(
      canRemoveTrack({
        adminUids,
        requesterName: "someone",
        senderName: "someone",
        senderUid: "admin-uid",
      }),
    ).toBe(true);
  });

  it("allows the requester to remove their own track", () => {
    expect(
      canRemoveTrack({
        adminUids,
        requesterName: "juan",
        senderName: "juan",
        senderUid: "someone-else",
      }),
    ).toBe(true);
  });

  it("rejects a third party removing a track they did not request", () => {
    expect(
      canRemoveTrack({
        adminUids,
        requesterName: "juan",
        senderName: "pedro",
        senderUid: "pedro-uid",
      }),
    ).toBe(false);
  });
});

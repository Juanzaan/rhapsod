import { describe, expect, it } from "vitest";

import {
  canMoveBot,
  canMoveBotToChannel,
  canRemoveTrack,
  hasAnyGroup,
  isAdminUid,
  parseAdminUids,
  parseChannelIds,
  parseMoveGroupIds,
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
        requesterUid: "juan-uid",
        senderName: "juan",
        senderUid: "juan-uid",
      }),
    ).toBe(true);
  });

  it("rejects a third party even when they rename to the requester's nickname", () => {
    expect(
      canRemoveTrack({
        adminUids,
        requesterName: "juan",
        requesterUid: "juan-uid",
        senderName: "juan",
        senderUid: "impostor-uid",
      }),
    ).toBe(false);
  });

  it("falls back to the nickname check when the requester uid is unknown", () => {
    expect(
      canRemoveTrack({
        adminUids,
        requesterName: "juan",
        senderName: "juan",
        senderUid: "juan-uid",
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

describe("parseMoveGroupIds", () => {
  it("parses a comma-separated list and trims entries", () => {
    expect(parseMoveGroupIds(" 6 , 8 , 10 ")).toEqual(
      new Set(["6", "8", "10"]),
    );
  });

  it("returns an empty set for empty input", () => {
    expect(parseMoveGroupIds(undefined)).toEqual(new Set());
    expect(parseMoveGroupIds("")).toEqual(new Set());
    expect(parseMoveGroupIds(",,")).toEqual(new Set());
  });
});

describe("canMoveBot", () => {
  const adminUids = new Set(["admin-uid"]);
  const moveGroupIds = new Set(["6", "8"]);

  it("allows admin UIDs regardless of groups", () => {
    expect(
      canMoveBot({
        senderUid: "admin-uid",
        senderGroups: [],
        adminUids,
        moveGroupIds,
      }),
    ).toBe(true);
  });

  it("allows users with a matching move group", () => {
    expect(
      canMoveBot({
        senderUid: "user-uid",
        senderGroups: ["6", "12"],
        adminUids,
        moveGroupIds,
      }),
    ).toBe(true);
  });

  it("rejects users with no matching groups", () => {
    expect(
      canMoveBot({
        senderUid: "user-uid",
        senderGroups: ["12", "15"],
        adminUids,
        moveGroupIds,
      }),
    ).toBe(false);
  });

  it("rejects users with empty groups", () => {
    expect(
      canMoveBot({
        senderUid: "user-uid",
        senderGroups: [],
        adminUids,
        moveGroupIds,
      }),
    ).toBe(false);
  });

  it("rejects everyone when moveGroupIds is empty and sender is not admin", () => {
    expect(
      canMoveBot({
        senderUid: "user-uid",
        senderGroups: ["6"],
        adminUids,
        moveGroupIds: new Set(),
      }),
    ).toBe(false);
  });
});

describe("parseChannelIds", () => {
  it("parses a comma-separated list of positive integers", () => {
    expect(parseChannelIds("63, 105 ,110")).toEqual(new Set([63, 105, 110]));
  });

  it("drops invalid entries", () => {
    expect(parseChannelIds("63,abc,-1,0")).toEqual(new Set([63]));
  });

  it("returns empty set for empty input", () => {
    expect(parseChannelIds(undefined)).toEqual(new Set());
    expect(parseChannelIds("")).toEqual(new Set());
  });
});

describe("hasAnyGroup", () => {
  it("returns true when the sender has a required group", () => {
    expect(hasAnyGroup(["90437", "90450"], new Set(["90450"]))).toBe(true);
  });

  it("returns false when no group matches", () => {
    expect(hasAnyGroup(["90437"], new Set(["90450"]))).toBe(false);
  });

  it("returns false when the required set is empty", () => {
    expect(hasAnyGroup(["90437"], new Set())).toBe(false);
  });
});

describe("canMoveBotToChannel", () => {
  const base = {
    adminUids: new Set(["admin-uid"]),
    moveGroupIds: new Set([
      "90438",
      "90437",
      "90436",
      "90472",
      "90466",
      "90430",
    ]),
    adminGroupIds: new Set(["90472", "90466"]),
    seniorGroupIds: new Set(["90430"]),
    adminChannelIds: new Set([74, 99]),
    seniorChannelIds: new Set([75]),
  };

  it("allows an admin uid into any channel", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "admin-uid",
        senderGroups: [],
        targetCid: 75,
      }),
    ).toBe("allow");
  });

  it("denies users outside the move groups entirely", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90475"],
        targetCid: 10,
      }),
    ).toBe("deny-rank");
  });

  it("allows a trial-mod+ user into a public channel", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90437"],
        targetCid: 10,
      }),
    ).toBe("allow");
  });

  it("denies a mod into an admin-only channel", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90437"],
        targetCid: 74,
      }),
    ).toBe("deny-admin");
  });

  it("denies an admin-rank user into a senior-only channel", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90472"],
        targetCid: 75,
      }),
    ).toBe("deny-senior");
  });

  it("allows a senior-rank user into a senior-only channel", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90430"],
        targetCid: 75,
      }),
    ).toBe("allow");
  });

  it("allows an admin-rank user into an admin-only channel", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90466"],
        targetCid: 99,
      }),
    ).toBe("allow");
  });

  it("allows a trial mod into an unrestricted staff room", () => {
    expect(
      canMoveBotToChannel({
        ...base,
        senderUid: "x",
        senderGroups: ["90438"],
        targetCid: 110,
      }),
    ).toBe("allow");
  });
});

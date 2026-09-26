import { AUTOPLAY_UID } from "../application/autoplay-picker.js";

export function parseAdminUids(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((uid) => uid.trim())
      .filter((uid) => uid.length > 0),
  );
}

export function parseMoveGroupIds(
  raw: string | undefined,
): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

export function parseChannelIds(raw: string | undefined): ReadonlySet<number> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );
}

export function hasAnyGroup(
  senderGroups: readonly string[],
  requiredGroupIds: ReadonlySet<string>,
): boolean {
  if (requiredGroupIds.size === 0) return false;
  return senderGroups.some((gid) => requiredGroupIds.has(gid));
}

export function isAdminUid(
  uid: string,
  adminUids: ReadonlySet<string>,
): boolean {
  return adminUids.size > 0 && adminUids.has(uid);
}

export function canMoveBot(args: {
  readonly senderUid: string;
  readonly senderGroups: readonly string[];
  readonly adminUids: ReadonlySet<string>;
  readonly moveGroupIds: ReadonlySet<string>;
}): boolean {
  if (isAdminUid(args.senderUid, args.adminUids)) return true;
  if (args.moveGroupIds.size === 0) return false;
  return args.senderGroups.some((gid) => args.moveGroupIds.has(gid));
}

export type MoveDecision = "allow" | "deny-rank" | "deny-admin" | "deny-senior";

export function canMoveBotToChannel(args: {
  readonly senderUid: string;
  readonly senderGroups: readonly string[];
  readonly adminUids: ReadonlySet<string>;
  readonly moveGroupIds: ReadonlySet<string>;
  readonly adminGroupIds: ReadonlySet<string>;
  readonly seniorGroupIds: ReadonlySet<string>;
  readonly adminChannelIds: ReadonlySet<number>;
  readonly seniorChannelIds: ReadonlySet<number>;
  readonly targetCid: number;
}): MoveDecision {
  if (isAdminUid(args.senderUid, args.adminUids)) return "allow";
  if (!hasAnyGroup(args.senderGroups, args.moveGroupIds)) return "deny-rank";
  if (
    args.seniorChannelIds.has(args.targetCid) &&
    !hasAnyGroup(args.senderGroups, args.seniorGroupIds)
  ) {
    return "deny-senior";
  }
  if (
    args.adminChannelIds.has(args.targetCid) &&
    !hasAnyGroup(args.senderGroups, args.adminGroupIds)
  ) {
    return "deny-admin";
  }
  return "allow";
}

export function canRemoveTrack(args: {
  readonly adminUids: ReadonlySet<string>;
  /** UIDs connected to the server; omit when unknown to stay strict. */
  readonly connectedUids?: ReadonlySet<string>;
  readonly requesterName: string;
  readonly requesterUid?: string;
  readonly senderName: string;
  readonly senderUid: string;
}): boolean {
  // Autoplay picks are communal (server-assigned sentinel uid, unspoofable):
  // anyone in the channel may skip them.
  if (args.requesterUid === AUTOPLAY_UID) return true;
  if (isAdminUid(args.senderUid, args.adminUids)) return true;
  // A requester who left the server can no longer skip or clear their own
  // tracks, so those tracks become communal too instead of pinning the
  // queue until an admin shows up.
  if (
    args.connectedUids !== undefined &&
    args.requesterUid !== undefined &&
    args.requesterUid.length > 0 &&
    !args.connectedUids.has(args.requesterUid)
  ) {
    return true;
  }
  if (args.requesterUid !== undefined && args.requesterUid.length > 0) {
    return args.requesterUid === args.senderUid;
  }
  return args.requesterName === args.senderName;
}

/**
 * Whole-queue actions (!stop, !clear) follow the same ownership rule as
 * !skip and !remove: allowed when every affected track is the sender's or
 * communal (autoplay, or its requester left the server), or the sender is
 * an admin. Without it anyone could wipe
 * everyone's tracks through the back door !skip forbids.
 */
export function canRemoveTracks(args: {
  readonly adminUids: ReadonlySet<string>;
  readonly connectedUids?: ReadonlySet<string>;
  readonly senderName: string;
  readonly senderUid: string;
  readonly tracks: ReadonlyArray<{
    readonly requestedBy: string;
    readonly requestedByUid?: string;
  }>;
}): boolean {
  return args.tracks.every((track) =>
    canRemoveTrack({
      adminUids: args.adminUids,
      ...(args.connectedUids === undefined
        ? {}
        : { connectedUids: args.connectedUids }),
      requesterName: track.requestedBy,
      ...(track.requestedByUid === undefined
        ? {}
        : { requesterUid: track.requestedByUid }),
      senderName: args.senderName,
      senderUid: args.senderUid,
    }),
  );
}

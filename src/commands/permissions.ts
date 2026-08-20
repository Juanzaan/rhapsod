export function parseAdminUids(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((uid) => uid.trim())
      .filter((uid) => uid.length > 0),
  );
}

export function isAdminUid(
  uid: string,
  adminUids: ReadonlySet<string>,
): boolean {
  return adminUids.size > 0 && adminUids.has(uid);
}

export function canRemoveTrack(args: {
  readonly adminUids: ReadonlySet<string>;
  readonly requesterName: string;
  readonly requesterUid?: string;
  readonly senderName: string;
  readonly senderUid: string;
}): boolean {
  if (isAdminUid(args.senderUid, args.adminUids)) return true;
  if (args.requesterUid !== undefined && args.requesterUid.length > 0) {
    return args.requesterUid === args.senderUid;
  }
  return args.requesterName === args.senderName;
}

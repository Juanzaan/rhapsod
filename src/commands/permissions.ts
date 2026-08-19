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
  readonly senderName: string;
  readonly senderUid: string;
}): boolean {
  return (
    isAdminUid(args.senderUid, args.adminUids) ||
    args.requesterName === args.senderName
  );
}

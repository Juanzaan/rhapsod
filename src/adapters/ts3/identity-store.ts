import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  generateIdentity,
  identityFromString,
  type Identity,
} from "@honeybbq/teamspeak-client";

const IDENTITY_SECURITY_LEVEL = 8;

export class Ts3IdentityStore {
  constructor(private readonly filePath: string) {}

  async loadOrCreate(): Promise<Identity> {
    try {
      return identityFromString((await readFile(this.filePath, "utf8")).trim());
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }

    const identity = generateIdentity(IDENTITY_SECURITY_LEVEL);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${identity.toString()}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.filePath, 0o600);
    return identity;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

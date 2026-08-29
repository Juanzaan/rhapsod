import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
    const raw = await this.#readExisting();
    if (raw !== undefined) return raw;

    const identity = generateIdentity(IDENTITY_SECURITY_LEVEL);
    await this.#write(identity);
    return identity;
  }

  async #readExisting(): Promise<Identity | undefined> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
      return undefined;
    }
    try {
      return identityFromString(content.trim());
    } catch {
      return undefined;
    }
  }

  async #write(identity: Identity): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${identity.toString()}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
    await chmod(this.filePath, 0o600);
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

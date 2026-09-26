import { randomInt, timingSafeEqual } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

export type ClaimResult =
  | { readonly status: "claimed"; readonly persisted: boolean }
  | { readonly status: "closed" }
  | { readonly status: "locked" }
  | { readonly status: "wrong-code" };

export interface AdminClaimOptions {
  /** Live admin set shared with the command context; a claim adds to it. */
  readonly adminUids: Set<string>;
  /** Where the pending code lives, so the installer can print it. */
  readonly codePath: string;
  /** Writes the new admin list to the env file; throws when it cannot. */
  readonly persist: (uids: readonly string[]) => Promise<void>;
  readonly generateCode?: () => string;
}

// No 0/o, 1/l/i: the code is read off a terminal and typed into a chat.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
// Ten characters from 31 symbols is about 49 bits; with five guesses per
// process start, guessing it over chat is not a practical attack.
const CODE_LENGTH = 10;
const MAX_ATTEMPTS = 5;

export function generateClaimCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function normalize(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * First-owner bootstrap: while no admin is configured, a one-time code is
 * written to the data directory and the first TeamSpeak user who sends
 * `!claim <code>` becomes admin. New users do not know their TeamSpeak UID,
 * which RHAPSOD_ADMIN_UIDS otherwise requires.
 */
export class AdminClaim {
  readonly #options: AdminClaimOptions;
  #code: string | undefined;
  #failures = 0;

  private constructor(options: AdminClaimOptions, code: string | undefined) {
    this.#options = options;
    this.#code = code;
  }

  static async open(options: AdminClaimOptions): Promise<AdminClaim> {
    if (options.adminUids.size > 0) {
      await rm(options.codePath, { force: true }).catch(() => undefined);
      return new AdminClaim(options, undefined);
    }
    // Reused across restarts: the installer prints the code once, and a
    // restart in between must not invalidate what the owner copied.
    let code = "";
    try {
      code = normalize(await readFile(options.codePath, "utf8"));
    } catch {
      // No pending code yet.
    }
    if (code.length !== CODE_LENGTH) {
      const generated = (options.generateCode ?? generateClaimCode)();
      // A read-only data directory must not stop the bot: the code is
      // still logged at startup.
      await writeFile(options.codePath, `${generated}\n`, {
        encoding: "utf8",
        mode: 0o600,
      }).catch(() => undefined);
      code = normalize(generated);
    }
    return new AdminClaim(options, code);
  }

  /** The pending code as shown to the owner, or undefined once claimed. */
  get code(): string | undefined {
    return this.#code === undefined
      ? undefined
      : `${this.#code.slice(0, 5)}-${this.#code.slice(5)}`;
  }

  async claim(uid: string, attempt: string): Promise<ClaimResult> {
    const expected = this.#code;
    if (expected === undefined || this.#options.adminUids.size > 0) {
      return { status: "closed" };
    }
    if (this.#failures >= MAX_ATTEMPTS) return { status: "locked" };
    const given = Buffer.from(normalize(attempt));
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      this.#failures++;
      return this.#failures >= MAX_ATTEMPTS
        ? { status: "locked" }
        : { status: "wrong-code" };
    }
    this.#code = undefined;
    this.#options.adminUids.add(uid);
    let persisted = true;
    try {
      await this.#options.persist([...this.#options.adminUids]);
    } catch {
      persisted = false;
    }
    await rm(this.#options.codePath, { force: true }).catch(() => undefined);
    return { status: "claimed", persisted };
  }
}

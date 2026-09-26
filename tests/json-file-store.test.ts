import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DebouncedWriter,
  quarantineUnreadableFile,
  readJsonFile,
  writeFileAtomic,
  writeJsonFile,
} from "../src/lib/json-file-store.js";

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhapsod-json-store-"));
  tempDirs.push(dir);
  return dir;
}

function corruptCopies(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".corrupt-"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

const acceptVersionOne = (raw: unknown): { version: 1 } | undefined =>
  typeof raw === "object" &&
  raw !== null &&
  (raw as { version?: unknown }).version === 1
    ? { version: 1 }
    : undefined;

describe("readJsonFile", () => {
  it("returns undefined without side effects when the file is missing", () => {
    const dir = makeDir();
    expect(readJsonFile(join(dir, "none.json"), acceptVersionOne)).toBe(
      undefined,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("returns the validated value and leaves a good file in place", () => {
    const dir = makeDir();
    const file = join(dir, "good.json");
    writeFileSync(file, JSON.stringify({ version: 1 }));
    expect(readJsonFile(file, acceptVersionOne)).toEqual({ version: 1 });
    expect(readdirSync(dir)).toEqual(["good.json"]);
  });

  it("sets aside a file that is not JSON, keeping its bytes", () => {
    const dir = makeDir();
    const file = join(dir, "broken.json");
    writeFileSync(file, '{"version": 1, "users": {');
    const warn = vi.fn();
    const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn };

    expect(readJsonFile(file, acceptVersionOne, logger)).toBeUndefined();

    const copies = corruptCopies(dir);
    expect(copies).toHaveLength(1);
    expect(readFileSync(join(dir, copies[0]!), "utf8")).toBe(
      '{"version": 1, "users": {',
    );
    expect(readdirSync(dir)).not.toContain("broken.json");
    expect(warn).toHaveBeenCalledWith(
      { file: "broken.json", savedAs: copies[0] },
      expect.stringContaining("set aside"),
    );
  });

  it("sets aside a file the validator rejects, such as a newer version", () => {
    const dir = makeDir();
    const file = join(dir, "future.json");
    writeFileSync(file, JSON.stringify({ version: 2 }));
    expect(readJsonFile(file, acceptVersionOne)).toBeUndefined();
    expect(corruptCopies(dir)).toHaveLength(1);
  });
});

describe("quarantineUnreadableFile", () => {
  it("reports an error instead of throwing when the move fails", () => {
    const dir = makeDir();
    const error = vi.fn();
    const logger = { debug: vi.fn(), error, info: vi.fn(), warn: vi.fn() };
    expect(
      quarantineUnreadableFile(join(dir, "gone.json"), logger),
    ).toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("writeFileAtomic", () => {
  it("creates the directory, writes the content and leaves no temp file", async () => {
    const dir = makeDir();
    const file = join(dir, "nested", "data.json");
    await writeFileAtomic(file, "first");
    await writeFileAtomic(file, "second");
    expect(readFileSync(file, "utf8")).toBe("second");
    expect(readdirSync(join(dir, "nested"))).toEqual(["data.json"]);
  });

  it.skipIf(process.platform === "win32")(
    "applies the requested mode to a new file",
    async () => {
      const dir = makeDir();
      const file = join(dir, "private.json");
      await writeFileAtomic(file, "{}", 0o600);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    },
  );

  it("writeJsonFile keeps its pretty-printed output", async () => {
    const dir = makeDir();
    const file = join(dir, "pretty.json");
    await writeJsonFile(file, { a: 1 });
    expect(readFileSync(file, "utf8")).toBe('{\n  "a": 1\n}');
  });
});

describe("DebouncedWriter", () => {
  it("coalesces a burst of changes into one write of the latest state", async () => {
    vi.useFakeTimers();
    try {
      let state = 0;
      const written: number[] = [];
      const writer = new DebouncedWriter(() => {
        written.push(state);
        return Promise.resolve();
      }, 1_000);
      for (let index = 1; index <= 5; index++) {
        state = index;
        writer.schedule();
      }
      expect(written).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(written).toEqual([5]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(written).toEqual([5]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flush writes pending changes at once and nothing when clean", async () => {
    const write = vi.fn(() => Promise.resolve());
    const writer = new DebouncedWriter(write, 60_000);
    await writer.flush();
    expect(write).not.toHaveBeenCalled();
    writer.schedule();
    await writer.flush();
    expect(write).toHaveBeenCalledOnce();
    await writer.flush();
    expect(write).toHaveBeenCalledOnce();
  });

  it("keeps writing after a failed write", async () => {
    const write = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const writer = new DebouncedWriter(write, 60_000);
    writer.schedule();
    await writer.flush();
    writer.schedule();
    await writer.flush();
    expect(write).toHaveBeenCalledTimes(2);
  });
});

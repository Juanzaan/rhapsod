import { describe, expect, it, vi } from "vitest";

import { RadioScrobbler } from "../src/application/radio-scrobbler.js";

function setup(
  searchImpl: (query: string) => Promise<{ id: string; title: string }> = (
    query: string,
  ) => Promise.resolve({ id: "yt-resolved", title: `Resolved ${query}` }),
) {
  const history = {
    recordFinish: vi.fn(),
    recordStart: vi.fn(),
  };
  const library = { record: vi.fn() };
  const resolver = { search: vi.fn(searchImpl) };
  const scrobbler = new RadioScrobbler(history, resolver, library);
  return { history, library, resolver, scrobbler };
}

const POLL = { source: "https://radio.example/jfk", uid: "uid-1" };

describe("RadioScrobbler", () => {
  it("records nothing on the first sighting of a title", async () => {
    const { history, library, resolver, scrobbler } = setup();

    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });

    expect(resolver.search).not.toHaveBeenCalled();
    expect(history.recordStart).not.toHaveBeenCalled();
    expect(history.recordFinish).not.toHaveBeenCalled();
    expect(library.record).not.toHaveBeenCalled();
  });

  it("scrobbles a resolved track once heard across two polls", async () => {
    const { history, library, resolver, scrobbler } = setup();

    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });

    expect(resolver.search).toHaveBeenCalledWith(
      "Duki Rockstar",
      undefined,
      "Duki - Rockstar",
    );
    expect(history.recordStart).toHaveBeenCalledTimes(1);
    expect(history.recordStart).toHaveBeenCalledWith("uid-1", {
      id: "yt-resolved",
      title: "Resolved Duki Rockstar",
    });
    expect(history.recordFinish).toHaveBeenCalledWith(
      "uid-1",
      { id: "yt-resolved", title: "Resolved Duki Rockstar" },
      true,
    );
    expect(library.record).toHaveBeenCalledTimes(1);
    expect(library.record).toHaveBeenCalledWith({
      id: "yt-resolved",
      title: "Resolved Duki Rockstar",
    });
  });

  it("never records the same title twice", async () => {
    const { history, scrobbler } = setup();

    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });

    expect(history.recordStart).toHaveBeenCalledTimes(1);
  });

  it("drops a title that changes before confirmation", async () => {
    const { history, scrobbler } = setup();

    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...POLL, title: "Bizarrap - Session" });
    await scrobbler.poll({ ...POLL, title: "Bizarrap - Session" });

    expect(history.recordStart).toHaveBeenCalledTimes(1);
    expect(history.recordStart).toHaveBeenCalledWith(
      "uid-1",
      expect.objectContaining({ title: "Resolved Bizarrap Session" }),
    );
  });

  it("keeps the raw title under a synthetic id when search fails", async () => {
    const { history, scrobbler } = setup(() =>
      Promise.reject(new Error("no match")),
    );

    await scrobbler.poll({ ...POLL, title: "Unknown - Obscure" });
    await scrobbler.poll({ ...POLL, title: "Unknown - Obscure" });

    expect(history.recordStart).toHaveBeenCalledTimes(1);
    const track = history.recordStart.mock.calls[0]?.[1] as
      { id: string; title: string } | undefined;
    expect(track?.title).toBe("Unknown - Obscure");
    expect(track?.id.startsWith("radio:")).toBe(true);
    expect(history.recordFinish).toHaveBeenCalledWith("uid-1", track, true);
  });

  it("ignores missing titles without losing the pending one", async () => {
    const { history, scrobbler } = setup();

    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...POLL, title: undefined });
    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });

    expect(history.recordStart).toHaveBeenCalledTimes(1);
  });

  it("tracks stations independently", async () => {
    const { history, scrobbler } = setup();
    const other = { ...POLL, source: "https://radio.example/other" };

    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...other, title: "Duki - Rockstar" });
    await scrobbler.poll({ ...POLL, title: "Duki - Rockstar" });

    expect(history.recordStart).toHaveBeenCalledTimes(1);
  });

  it("never throws when history or search blow up", async () => {
    const { history, scrobbler } = setup(() =>
      Promise.reject(new Error("down")),
    );
    history.recordStart.mockImplementation(() => {
      throw new Error("disk full");
    });

    await expect(
      scrobbler.poll({ ...POLL, title: "Duki - Rockstar" }),
    ).resolves.toBeUndefined();
    await expect(
      scrobbler.poll({ ...POLL, title: "Duki - Rockstar" }),
    ).resolves.toBeUndefined();
  });
});

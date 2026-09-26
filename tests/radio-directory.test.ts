import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetRadioMirrorCache,
  searchStations,
} from "../src/media/radio-directory.js";
import { APP_VERSION } from "../src/lib/version.js";

const DE1 = ["de1.api.radio-browser.info"];

beforeEach(() => {
  resetRadioMirrorCache();
});

function stationResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("searchStations", () => {
  it("returns parsed stations top voted first", async () => {
    let sentUrl = "";
    let sentAgent: string | null = null;
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      sentUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      sentAgent = new Headers(init?.headers).get("User-Agent");
      return Promise.resolve(
        stationResponse([
          {
            bitrate: 128,
            codec: "MP3",
            country: "United States",
            name: "Groove Salad",
            tags: "ambient,beats",
            url: "http://ice1.somafm.com/groovesalad-128-mp3",
            url_resolved: "https://ice1.somafm.com/groovesalad-128-mp3",
            votes: 1200,
          },
          { name: "", url: "https://example.com/broken" },
          "garbage",
        ]),
      );
    });

    const stations = await searchStations("groove", { fetch, mirrors: DE1 });

    expect(sentUrl).toContain("de1.api.radio-browser.info");
    expect(sentUrl).toContain("name=groove");
    expect(sentAgent).toContain(`Rhapsod/${APP_VERSION}`);
    expect(stations).toEqual([
      {
        bitrate: 128,
        codec: "MP3",
        country: "United States",
        name: "Groove Salad",
        tags: "ambient,beats",
        url: "https://ice1.somafm.com/groovesalad-128-mp3",
        votes: 1200,
      },
    ]);
  });

  it("returns [] when the directory is unreachable or broken", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("down")),
    );
    await expect(
      searchStations("jazz", { fetch: failing, mirrors: DE1 }),
    ).resolves.toEqual([]);

    const broken = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("not json", { status: 500 })),
    );
    await expect(
      searchStations("jazz", { fetch: broken, mirrors: DE1 }),
    ).resolves.toEqual([]);

    const hanging = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {}),
    );
    await expect(
      searchStations("jazz", { fetch: hanging, timeoutMs: 20 }),
    ).resolves.toEqual([]);
  });

  it("discovers mirrors once and moves to the next one on failure", async () => {
    // Regression: every search went to de1, so !radio found nothing while
    // that one mirror was down.
    const hits: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      hits.push(url.hostname + url.pathname);
      if (url.pathname === "/json/servers") {
        return Promise.resolve(
          stationResponse([
            { name: "at1.api.radio-browser.info" },
            { name: "nl1.api.radio-browser.info" },
            { name: "evil.example.com" },
          ]),
        );
      }
      if (hits.filter((hit) => hit.endsWith("/search")).length === 1) {
        return Promise.resolve(new Response("down", { status: 503 }));
      }
      return Promise.resolve(
        stationResponse([{ name: "Radio", url: "https://r.example/s" }]),
      );
    });

    const first = await searchStations("rock", { fetch });
    const second = await searchStations("rock", { fetch });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(hits.filter((hit) => hit.endsWith("/json/servers"))).toHaveLength(1);
    const searched = hits
      .filter((hit) => hit.endsWith("/search"))
      .map((hit) => hit.split("/")[0]);
    expect(new Set(searched.slice(0, 2)).size).toBe(2);
    expect(
      searched.every((host) =>
        ["at1.api.radio-browser.info", "nl1.api.radio-browser.info"].includes(
          host!,
        ),
      ),
    ).toBe(true);
  });

  it("falls back to built-in mirrors when discovery fails", async () => {
    const hosts: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/json/servers") {
        return Promise.reject(new Error("dns"));
      }
      hosts.push(url.hostname);
      return Promise.resolve(stationResponse([]));
    });
    await searchStations("rock", { fetch });
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatch(/^(de1|de2|fi1)\.api\.radio-browser\.info$/);
  });
});

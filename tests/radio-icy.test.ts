import { describe, expect, it, vi } from "vitest";

import {
  fetchIcyTitle,
  parseIcyStreamTitle,
  RadioTitleCache,
} from "../src/media/radio-icy.js";

function icyResponse(metaint: number, meta: string): Response {
  const encoder = new TextEncoder();
  const paddedLength = Math.ceil(encoder.encode(meta).length / 16) * 16;
  const body = new Uint8Array(metaint + 1 + paddedLength);
  body[metaint] = paddedLength / 16;
  body.set(encoder.encode(meta.padEnd(paddedLength, "\0")), metaint + 1);
  return new Response(body, {
    headers: { "icy-metaint": String(metaint) },
  });
}

describe("parseIcyStreamTitle", () => {
  it("extracts the stream title", () => {
    expect(
      parseIcyStreamTitle(
        new TextEncoder().encode(
          "StreamTitle='Zero Cult - Till The Morning';StreamUrl='https://x/';",
        ),
      ),
    ).toBe("Zero Cult - Till The Morning");
  });

  it("rejects empty and missing titles", () => {
    expect(
      parseIcyStreamTitle(new TextEncoder().encode("StreamTitle='';")),
    ).toBeUndefined();
    expect(
      parseIcyStreamTitle(new TextEncoder().encode("no metadata")),
    ).toBeUndefined();
    expect(parseIcyStreamTitle(new Uint8Array(0))).toBeUndefined();
  });
});

describe("fetchIcyTitle", () => {
  it("requests ICY metadata and returns the live title", async () => {
    let sentHeaders: Headers | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      sentHeaders = new Headers(init?.headers);
      return Promise.resolve(
        icyResponse(16, "StreamTitle='Live Artist - Live Song';"),
      );
    });

    const title = await fetchIcyTitle("https://ice.example/stream", { fetch });

    expect(title).toBe("Live Artist - Live Song");
    expect(sentHeaders?.get("Icy-MetaData")).toBe("1");
  });

  it("returns undefined without an icy-metaint header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("audio-bytes")),
    );

    await expect(
      fetchIcyTitle("https://example.com/file.mp3", { fetch }),
    ).resolves.toBeUndefined();
  });

  it("skips empty metadata blocks", async () => {
    const encoder = new TextEncoder();
    const second = "StreamTitle='Second Song';";
    const padded = Math.ceil(encoder.encode(second).length / 16) * 16;
    const body = new Uint8Array(8 + 1 + 0 + 8 + 1 + padded);
    body[8] = 0;
    body[8 + 1 + 8] = padded / 16;
    body.set(encoder.encode(second.padEnd(padded, "\0")), 8 + 1 + 8 + 1);
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(body, { headers: { "icy-metaint": "8" } })),
    );

    await expect(
      fetchIcyTitle("https://ice.example/stream", { fetch }),
    ).resolves.toBe("Second Song");
  });

  it("never throws on network failures", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("down")),
    );
    await expect(
      fetchIcyTitle("https://ice.example/stream", { fetch: failing }),
    ).resolves.toBeUndefined();

    const hanging = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {}),
    );
    await expect(
      fetchIcyTitle("https://ice.example/stream", {
        fetch: hanging,
        timeoutMs: 20,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("RadioTitleCache", () => {
  it("caches titles and deduplicates in-flight requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(icyResponse(16, "StreamTitle='Cached';")),
    );
    const cache = new RadioTitleCache({ fetch });

    const [first, second] = await Promise.all([
      cache.get("https://ice.example/stream"),
      cache.get("https://ice.example/stream"),
    ]);
    expect(first).toBe("Cached");
    expect(second).toBe("Cached");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.peek("https://ice.example/stream")).toBe("Cached");
    expect(cache.peek("https://ice.example/other")).toBeUndefined();
  });

  it("refetches after the TTL expires", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(icyResponse(16, "StreamTitle='Fresh';")),
    );
    const cache = new RadioTitleCache({ fetch, ttlMs: 10 });

    await cache.get("https://ice.example/stream");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cache.get("https://ice.example/stream");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches misses so dead streams do not hammer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("audio-bytes")),
    );
    const cache = new RadioTitleCache({ fetch });

    await cache.get("https://example.com/file.mp3");
    await cache.get("https://example.com/file.mp3");

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

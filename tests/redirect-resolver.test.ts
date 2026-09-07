import { describe, expect, it } from "vitest";

import { RedirectResolver } from "../src/media/redirect-resolver.js";

interface FakeResponse {
  readonly headers: Headers;
  readonly status: number;
}

function fakeFetch(
  responses: ReadonlyMap<string, FakeResponse>,
): (input: string | URL) => Response {
  return (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = responses.get(url);
    if (response === undefined) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return response as unknown as Response;
  };
}

function response(status: number, location?: string): FakeResponse {
  const headers = new Headers();
  if (location !== undefined) headers.set("location", location);
  return { headers, status };
}

describe("RedirectResolver", () => {
  it("follows a redirect chain to the final URL", async () => {
    const resolver = new RedirectResolver({
      fetch: fakeFetch(
        new Map([
          ["https://1.1.1.1/a", response(302, "https://2.2.2.2/b")],
          ["https://2.2.2.2/b", response(200)],
        ]),
      ) as unknown as typeof fetch,
    });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://2.2.2.2/b",
    );
  });

  it("returns the URL itself when there is no redirect", async () => {
    const resolver = new RedirectResolver({
      fetch: fakeFetch(
        new Map([["https://1.1.1.1/a", response(200)]]),
      ) as unknown as typeof fetch,
    });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://1.1.1.1/a",
    );
  });

  it("resolves relative Location headers against the current URL", async () => {
    const resolver = new RedirectResolver({
      fetch: fakeFetch(
        new Map([
          ["https://1.1.1.1/a", response(302, "/b")],
          ["https://1.1.1.1/b", response(200)],
        ]),
      ) as unknown as typeof fetch,
    });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://1.1.1.1/b",
    );
  });

  it("aborts when the redirect limit is exceeded", async () => {
    const resolver = new RedirectResolver({
      fetch: fakeFetch(
        new Map([
          ["https://1.1.1.1/a", response(302, "https://2.2.2.2/b")],
          ["https://2.2.2.2/b", response(302, "https://3.3.3.3/c")],
          ["https://3.3.3.3/c", response(302, "https://4.4.4.4/d")],
        ]),
      ) as unknown as typeof fetch,
      maxRedirects: 2,
    });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBeUndefined();
  });

  it("rejects private hosts and redirects into private networks", async () => {
    const resolver = new RedirectResolver({
      fetch: fakeFetch(
        new Map([
          [
            "https://1.1.1.1/a",
            response(302, "https://169.254.169.254/latest"),
          ],
        ]),
      ) as unknown as typeof fetch,
    });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBeUndefined();
    expect(await resolver.resolve("https://127.0.0.1/x")).toBeUndefined();
    expect(await resolver.resolve("http://1.1.1.1/a")).toBeUndefined();
  });

  it("caches the resolved chain", async () => {
    let calls = 0;
    const resolver = new RedirectResolver({
      fetch: ((input: string | URL) => {
        calls++;
        const url = typeof input === "string" ? input : input.toString();
        return (url === "https://1.1.1.1/a"
          ? response(302, "https://2.2.2.2/b")
          : response(200)) as unknown as Response;
      }) as unknown as typeof fetch,
    });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://2.2.2.2/b",
    );
    const callsAfterFirst = calls;
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://2.2.2.2/b",
    );
    expect(calls).toBe(callsAfterFirst);
  });

  it("falls back to a ranged GET when HEAD is rejected with 405", async () => {
    // Several CDNs answer HEAD with 405; resolution used to fail for them.
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = ((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "HEAD") {
        return Promise.resolve(response(405) as unknown as Response);
      }
      return Promise.resolve(response(200) as unknown as Response);
    }) as unknown as typeof fetch;
    const resolver = new RedirectResolver({ fetch: fetchImpl });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://1.1.1.1/a",
    );
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "GET"]);
  });

  it("falls back through a redirect chain when HEAD is rejected", async () => {
    const fetchImpl = ((input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "HEAD") {
        return Promise.resolve(response(405) as unknown as Response);
      }
      if (url === "https://1.1.1.1/a") {
        return Promise.resolve(
          response(302, "https://2.2.2.2/b") as unknown as Response,
        );
      }
      return Promise.resolve(response(200) as unknown as Response);
    }) as unknown as typeof fetch;
    const resolver = new RedirectResolver({ fetch: fetchImpl });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBe(
      "https://2.2.2.2/b",
    );
  });

  it("does not paper over genuine client errors in the GET fallback", async () => {
    const fetchImpl = ((_input: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "HEAD") {
        return Promise.resolve(response(405) as unknown as Response);
      }
      return Promise.resolve(response(404) as unknown as Response);
    }) as unknown as typeof fetch;
    const resolver = new RedirectResolver({ fetch: fetchImpl });
    expect(await resolver.resolve("https://1.1.1.1/a")).toBeUndefined();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

import { YoutubeOAuth } from "../src/lib/youtube-oauth.js";

function createMockFetch(responseBody: object, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(responseBody),
    text: () => Promise.resolve(JSON.stringify(responseBody)),
  });
}

describe("YoutubeOAuth", () => {
  const config = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    refreshToken: "test-refresh-token",
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: 1000000000000 });
  });

  it("fetches access token from Google OAuth endpoint", async () => {
    const mockFetch = createMockFetch({
      access_token: "ya29.test-access-token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    const oauth = new YoutubeOAuth(config, mockFetch);
    const token = await oauth.getAccessToken();

    expect(token).toBe("ya29.test-access-token");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const body = init.body as string;
    expect(body).toContain("client_id=test-client-id");
    expect(body).toContain("client_secret=test-client-secret");
    expect(body).toContain("refresh_token=test-refresh-token");
    expect(body).toContain("grant_type=refresh_token");
  });

  it("caches access token until near expiry", async () => {
    const mockFetch = createMockFetch({
      access_token: "ya29.cached-token",
      expires_in: 3600,
      token_type: "Bearer",
    });

    const oauth = new YoutubeOAuth(config, mockFetch);
    const first = await oauth.getAccessToken();
    const second = await oauth.getAccessToken();

    expect(first).toBe("ya29.cached-token");
    expect(second).toBe("ya29.cached-token");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("refreshes token when near expiry", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: "ya29.first-token",
            expires_in: 60,
            token_type: "Bearer",
          }),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: "ya29.second-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        text: () => Promise.resolve(""),
      });

    const oauth = new YoutubeOAuth(config, mockFetch);
    const first = await oauth.getAccessToken();

    vi.advanceTimersByTime(61_000);

    const second = await oauth.getAccessToken();

    expect(first).toBe("ya29.first-token");
    expect(second).toBe("ya29.second-token");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on HTTP error", async () => {
    const mockFetch = createMockFetch({ error: "invalid_grant" }, 400);

    const oauth = new YoutubeOAuth(config, mockFetch);

    await expect(oauth.getAccessToken()).rejects.toThrow(
      "YouTube OAuth token refresh failed (400)",
    );
  });

  it("throws when response missing access_token", async () => {
    const mockFetch = createMockFetch({ token_type: "Bearer" });

    const oauth = new YoutubeOAuth(config, mockFetch);

    await expect(oauth.getAccessToken()).rejects.toThrow(
      "YouTube OAuth response missing access_token",
    );
  });

  it("invalidates cached token", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: "ya29.first",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: "ya29.second",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        text: () => Promise.resolve(""),
      });

    const oauth = new YoutubeOAuth(config, mockFetch);
    const first = await oauth.getAccessToken();
    oauth.invalidate();
    const second = await oauth.getAccessToken();

    expect(first).toBe("ya29.first");
    expect(second).toBe("ya29.second");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

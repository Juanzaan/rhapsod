import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCallbackHandler } from "../scripts/spotify-auth.mjs";

const STATE = "expected-state-value-0123456789";
let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(): Promise<{
  base: string;
  onCode: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
}> {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onCode = vi.fn((_code: string, response: { end: () => void }) => {
    response.end();
  });
  const onError = vi.fn();
  server = createServer(
    createCallbackHandler({ state: STATE, onCode, onError }),
  );
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, onCode, onError };
}

describe("spotify-auth callback", () => {
  it.each([
    ["no state", "/callback?code=abc"],
    ["a wrong state", "/callback?code=abc&state=forged"],
    [
      "a state of the right length",
      `/callback?code=abc&state=${"x".repeat(STATE.length)}`,
    ],
    ["an error and no state", "/callback?error=access_denied"],
  ])("ignores a callback with %s and keeps waiting", async (_label, path) => {
    // Regression: the callback took any code, and a request without one
    // ended the whole flow.
    const { base, onCode, onError } = await start();
    const response = await fetch(`${base}${path}`);
    expect(response.status).toBe(400);
    expect(onCode).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("exchanges the code when the state matches", async () => {
    const { base, onCode } = await start();
    const response = await fetch(`${base}/callback?code=abc&state=${STATE}`);
    expect(response.status).toBe(200);
    expect(onCode).toHaveBeenCalledWith("abc", expect.anything());
  });

  it("reports an authorization error only with a valid state", async () => {
    const { base, onError } = await start();
    const response = await fetch(
      `${base}/callback?error=access_denied&state=${STATE}`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("access_denied");
    expect(onError).toHaveBeenCalledWith("access_denied");
  });

  it("answers 404 outside /callback", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });
});

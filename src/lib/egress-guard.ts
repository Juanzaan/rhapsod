import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";

import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";
import { isBlockedAddress, lookupHostnames } from "./ssrf.js";

/**
 * Local CONNECT proxy that ffmpeg and ffprobe send every connection
 * through. Checking the input URL before spawning is not enough: ffmpeg
 * follows redirects and opens HLS segment and key URLs on its own, so an
 * https URL that answered 302 to http://169.254.169.254/ or to the yt-dlp
 * daemon on 127.0.0.1 made it fetch those. Through this proxy each hop is
 * resolved here, refused when any address is private, and connected to the
 * address that was checked, so a second DNS answer cannot swap it.
 *
 * Plain-HTTP requests are always refused: audio inputs must be HTTPS, and a
 * redirect to http:// arrives here as a GET with an absolute URL.
 */
export interface EgressGuard {
  readonly proxyUrl: string;
  close(): Promise<void>;
}

export interface EgressGuardOptions {
  readonly logger?: MinimalLogger;
  /** Test seam; production resolves with the SSRF module's lookup. */
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  /** Test seam; production refuses every non-unicast address. */
  readonly allowTarget?: (address: string, port: number) => boolean;
}

const CONNECT_TIMEOUT_MS = 5_000;

// ffmpeg retries a 403 and then falls back to the WARP egress (see
// isForbiddenResponse), so a refusal must never read as a 403.
const REFUSED = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n";

export async function startEgressGuard(
  options: EgressGuardOptions = {},
): Promise<EgressGuard> {
  const logger = options.logger ?? noopLogger;
  const lookup =
    options.lookup ??
    (async (hostname: string) =>
      (await lookupHostnames(hostname)).map(({ address }) => address));
  const allowTarget =
    options.allowTarget ?? ((address: string) => !isBlockedAddress(address));
  const sockets = new Set<Duplex>();

  const server: Server = createServer((request, response) => {
    logger.warn(
      { method: request.method, host: hostOf(request.url) },
      "Egress guard refused a plain-HTTP request from ffmpeg",
    );
    response.writeHead(502, { connection: "close" });
    response.end();
  });

  server.on("connect", (request: IncomingMessage, client: Duplex, head) => {
    sockets.add(client);
    client.once("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    void tunnel(request.url ?? "", client, head);
  });
  server.on("clientError", (_error, socket) => socket.destroy());

  async function tunnel(
    target: string,
    client: Duplex,
    head: Buffer,
  ): Promise<void> {
    const parsed = parseTarget(target);
    if (parsed === undefined) {
      client.end(REFUSED);
      return;
    }
    let addresses: readonly string[];
    try {
      addresses =
        isIP(parsed.host) === 0 ? await lookup(parsed.host) : [parsed.host];
    } catch {
      client.end(REFUSED);
      return;
    }
    if (
      addresses.length === 0 ||
      addresses.some((candidate) => !allowTarget(candidate, parsed.port))
    ) {
      logger.warn(
        { host: parsed.host, port: parsed.port },
        "Egress guard refused a connection to a private address",
      );
      client.end(REFUSED);
      return;
    }
    if (client.destroyed) return;
    // IPv4 first: googlevideo URLs are signed for the address yt-dlp
    // resolved from (it runs with force_ipv4), and some hosts have no IPv6
    // route at all. Later addresses are tried only when one fails.
    const ordered = [
      ...addresses.filter((candidate) => isIP(candidate) === 4),
      ...addresses.filter((candidate) => isIP(candidate) !== 4),
    ];
    const upstream = await connectFirst(ordered, parsed.port);
    if (upstream === undefined) {
      if (!client.destroyed) client.end(REFUSED);
      return;
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.on("error", () => upstream.destroy());
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    upstream.once("close", () => client.destroy());
    client.once("close", () => upstream.destroy());
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref();
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Egress guard did not get a TCP port");
  }

  return {
    proxyUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function connectFirst(
  addresses: readonly string[],
  port: number,
): Promise<Socket | undefined> {
  for (const address of addresses) {
    const socket = await new Promise<Socket | undefined>((resolve) => {
      const attempt = connect({ host: address, port });
      attempt.setTimeout(CONNECT_TIMEOUT_MS, () => {
        attempt.destroy();
        resolve(undefined);
      });
      attempt.once("connect", () => {
        attempt.setTimeout(0);
        resolve(attempt);
      });
      attempt.once("error", () => resolve(undefined));
    });
    if (socket !== undefined) return socket;
  }
  return undefined;
}

function parseTarget(
  target: string,
): { readonly host: string; readonly port: number } | undefined {
  const match = /^(?:\[([0-9a-f:.]+)\]|([^\s:/[\]]+)):(\d{1,5})$/i.exec(target);
  if (match === null) return undefined;
  const host = (match[1] ?? match[2] ?? "").toLowerCase();
  const port = Number(match[3]);
  if (host.length === 0 || port < 1 || port > 65_535) return undefined;
  return { host, port };
}

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = "playlist-read-private playlist-read-collaborative";

function loadEnv() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  try {
    process.loadEnvFile(envPath);
    console.log(`Cargado ${envPath}`);
  } catch {
    // No .env file; rely on environment variables.
  }
}

function envValue(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name} in the environment or .env file`);
  return value;
}

/**
 * Answers the OAuth redirect. Only a callback carrying the state this run
 * generated is acted on: without it, any page open in the browser could
 * send a forged /callback (login CSRF, or the bare request that used to end
 * the flow). Anything else gets a 400 and the script keeps waiting.
 */
export function createCallbackHandler({ state, onCode, onError }) {
  const expected = Buffer.from(state);
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/callback") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const received = Buffer.from(url.searchParams.get("state") ?? "");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      console.error("Callback ignored: missing or wrong state parameter.");
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Invalid state; keep using the URL printed in the terminal");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      // The error query param is attacker-controllable; reflect it only in
      // the terminal, never in the HTTP response body.
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("Authorization failed; see the terminal for details");
      onError(url.searchParams.get("error") ?? "missing code");
      return;
    }
    onCode(code, response);
  };
}

function main() {
  loadEnv();
  const clientId = envValue("RHAPSOD_SPOTIFY_CLIENT_ID");
  const clientSecret = envValue("RHAPSOD_SPOTIFY_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const state = randomBytes(24).toString("base64url");

  const server = createServer(
    createCallbackHandler({
      state,
      onCode: (code, response) => void exchange(basic, code, response),
      onError: (error) => {
        console.error(`Authorization failed: ${error}`);
        process.exit(1);
      },
    }),
  );

  const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", SCOPES);
  authorizeUrl.searchParams.set("state", state);

  // Loopback only: the redirect URI is 127.0.0.1, and on a server listening
  // on every interface anyone on the network could reach the callback.
  server.listen(REDIRECT_PORT, "127.0.0.1", () => {
    console.log("1. Abri esta URL y logueate con tu cuenta de Spotify:");
    console.log(authorizeUrl.toString());
    console.log(
      `\n2. El redirect URI ${REDIRECT_URI} debe estar registrado en el Dashboard de Spotify (app settings).`,
    );
    console.log("Esperando el callback...");
  });

  setTimeout(
    () => {
      console.error("Tiempo agotado: no se recibio el callback.");
      process.exit(1);
    },
    5 * 60 * 1000,
  );
}

async function exchange(basic, code, response) {
  try {
    const tokenResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
        }),
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed with ${tokenResponse.status}`);
    }
    const json = await tokenResponse.json();
    const refreshToken = json.refresh_token;
    if (!refreshToken) {
      throw new Error("Token response is missing refresh_token");
    }
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      "Listo: Rhapsod puede conectarse a tu cuenta de Spotify. Ya podes cerrar esta pestaña.",
    );
    console.log("\nRefresh token obtenido. Configuralo en el servidor:\n");
    console.log(`RHAPSOD_SPOTIFY_REFRESH_TOKEN=${refreshToken}`);
    console.log(
      "\nAgrega esta variable al .env del VM (o al unit de systemd) y reinicia el servicio.",
    );
    process.exit(0);
  } catch (error) {
    response.writeHead(500);
    response.end("Error: ver la consola");
    console.error(error);
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();

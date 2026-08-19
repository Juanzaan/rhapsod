import { createServer } from "node:http";

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = "playlist-read-private playlist-read-collaborative";

function loadEnv() {
  try {
    process.loadEnvFile();
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

const clientId = envValue("RHAPSOD_SPOTIFY_CLIENT_ID");
const clientSecret = envValue("RHAPSOD_SPOTIFY_CLIENT_SECRET");
const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/callback") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code) {
    response.writeHead(400);
    response.end(`Authorization failed: ${error ?? "missing code"}`);
    console.error(`Authorization failed: ${error ?? "missing code"}`);
    process.exit(1);
  }
  void exchange(code, response);
});

async function exchange(code, response) {
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

const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
authorizeUrl.searchParams.set("client_id", clientId);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authorizeUrl.searchParams.set("scope", SCOPES);

server.listen(REDIRECT_PORT, () => {
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

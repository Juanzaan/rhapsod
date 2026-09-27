# Rhapsod — TeamSpeak 3 music bot
# Multi-stage build: Node for the bot, Python for the yt-dlp daemon.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# ffmpeg-static is optional and skipped: the runtime image installs ffmpeg
# from apt and the bot falls back to the ffmpeg on PATH.
RUN npm ci --omit=optional
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/Juanzaan/rhapsod"
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp for the daemon's PYTHONPATH (the pip extra pulls requests/certifi).
# Pinned so a build is reproducible; the weekly image workflow rebuilds the
# latest release with the newest yt-dlp, since YouTube breaks old versions.
# The POT plugin is pinned to the provider image in docker-compose.yml: the
# plugin and the server must speak the same protocol version.
ARG YTDLP_VERSION=2026.8.19
RUN python3 -m venv /opt/ytdlp \
  && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default]==${YTDLP_VERSION}" \
    "bgutil-ytdlp-pot-provider==2.0.0"
ENV PATH="/opt/ytdlp/bin:${PATH}"

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm prune --omit=dev --omit=optional \
  && install -d -o node -g node /app/data
ENV NODE_ENV=production \
  RHAPSOD_DATA_DIR=/app/data \
  RHAPSOD_ENV_FILE=/app/data/.env

# Run as the image's unprivileged `node` user (uid 1000). A named volume on
# /app/data takes that owner from the image; a bind mount needs it chowned.
USER node
VOLUME ["/app/data"]

# The panel starts after the TeamSpeak connection, which can take up to
# RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS (180 by default). The check reads the
# panel with the password from the env file, so it needs the panel enabled.
HEALTHCHECK --interval=60s --timeout=15s --start-period=240s --start-interval=5s --retries=3 \
  CMD ["node", "dist/cli.js", "status", "--json"]

EXPOSE 8080
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]

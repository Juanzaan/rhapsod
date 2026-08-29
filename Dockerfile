# Rhapsod — TeamSpeak 3 music bot
# Multi-stage build: Node for the bot, Python for the yt-dlp daemon.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg curl \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp for the daemon's PYTHONPATH (the pip extra pulls requests/certifi).
RUN python3 -m pip install --no-cache-dir "yt-dlp[default]"
# Standalone yt-dlp binary for the bot's spawn path.
RUN curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
ENV NODE_ENV=production

EXPOSE 8080
CMD ["node", "dist/main.js"]
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createYoutubeiClient } from "../src/media/youtube/youtubei-client.js";

const VIDEO_URL =
  process.argv[2] ?? "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const videoId = new URL(VIDEO_URL).searchParams.get("v");
if (!videoId) {
  console.error("No video id found in URL");
  process.exit(1);
}

const CACHE_DIR = join(process.cwd(), "data", "youtubei-cache");

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });

  const sessionStart = Date.now();
  const youtube = await createYoutubeiClient({ cacheDirectory: CACHE_DIR });
  console.log(
    `[init] session created in ${Date.now() - sessionStart}ms (cache: ${CACHE_DIR})`,
  );

  for (let run = 1; run <= 3; run++) {
    const t0 = Date.now();
    const info = await youtube.getBasicInfo(videoId);
    const t1 = Date.now();
    const format = info.chooseFormat({ type: "audio", quality: "best" });
    if (!format)
      throw new Error("youtubei.js returned no playable audio format");
    const url = await format.decipher(youtube.session.player);
    const t2 = Date.now();

    console.log(
      JSON.stringify(
        {
          run,
          client: "IOS",
          title: info.basic_info.title,
          durationSeconds: info.basic_info.duration,
          itag: format.itag,
          mime: format.mime_type,
          hasHttpsUrl: typeof url === "string" && url.startsWith("https://"),
          getBasicInfoMs: t1 - t0,
          decipherMs: t2 - t1,
          totalMs: t2 - t0,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

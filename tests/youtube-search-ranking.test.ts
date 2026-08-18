import { describe, expect, it } from "vitest";

import { rankYoutubeCandidates } from "../src/media/youtube/search-ranking.js";

describe("rankYoutubeCandidates", () => {
  it("prefers an official matching result over a cover", () => {
    const selected = rankYoutubeCandidates("duki rockstar", [
      {
        id: "cover",
        title: "Duki Rockstar cover live",
        webpageUrl: "https://youtube.com/watch?v=cover",
      },
      {
        id: "official",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=official",
      },
    ]);

    expect(selected?.id).toBe("official");
  });

  it("rejects unrelated results", () => {
    expect(
      rankYoutubeCandidates("duki rockstar", [
        {
          id: "wrong",
          title: "Podcast sobre producción musical",
          webpageUrl: "https://youtube.com/watch?v=wrong",
        },
      ]),
    ).toBeUndefined();
  });

  it("penalizes short and altered versions", () => {
    const selected = rankYoutubeCandidates("the weeknd starboy", [
      {
        durationSeconds: 25,
        id: "short",
        title: "The Weeknd Starboy slowed shorts",
        webpageUrl: "https://youtube.com/watch?v=short",
      },
      {
        durationSeconds: 230,
        id: "song",
        title: "The Weeknd - Starboy official audio",
        webpageUrl: "https://youtube.com/watch?v=song",
      },
    ]);

    expect(selected?.id).toBe("song");
  });
});

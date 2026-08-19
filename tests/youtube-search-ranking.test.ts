import { describe, expect, it } from "vitest";

import {
  rankYoutubeCandidates,
  rankYoutubeCandidatesAll,
} from "../src/media/youtube/search-ranking.js";

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

  it("prefers official music channels when title relevance is similar", () => {
    const selected = rankYoutubeCandidates("artist song", [
      {
        channel: "Random Uploads",
        id: "random",
        title: "Artist - Song",
        webpageUrl: "https://youtube.com/watch?v=random",
      },
      {
        channel: "Artist - Topic",
        id: "topic",
        title: "Artist - Song",
        webpageUrl: "https://youtube.com/watch?v=topic",
      },
    ]);

    expect(selected?.id).toBe("topic");
  });

  it("returns ordered candidates above the confidence threshold", () => {
    const ranked = rankYoutubeCandidatesAll("the weeknd starboy", [
      {
        id: "official",
        title: "The Weeknd - Starboy (Official Audio)",
        webpageUrl: "https://youtube.com/watch?v=official",
      },
      {
        id: "plain",
        title: "The Weeknd - Starboy",
        webpageUrl: "https://youtube.com/watch?v=plain",
      },
      {
        id: "unrelated",
        title: "Podcast sobre producción musical",
        webpageUrl: "https://youtube.com/watch?v=unrelated",
      },
    ]);

    expect(ranked.map((candidate) => candidate.id)).toEqual([
      "plain",
      "official",
    ]);
  });

  it("returns an empty list when no candidate is reliable", () => {
    expect(
      rankYoutubeCandidatesAll("duki rockstar", [
        {
          id: "wrong",
          title: "Documental sobre Duki",
          webpageUrl: "https://youtube.com/watch?v=wrong",
        },
      ]),
    ).toEqual([]);
  });

  it("prefers a remix when the query asks for one", () => {
    const selected = rankYoutubeCandidates("anuel aa sola remix", [
      {
        id: "original",
        title: "Anuel AA - Sola",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
      {
        id: "remix",
        title: "Anuel AA - Sola (Remix) ft. Daddy Yankee",
        webpageUrl: "https://youtube.com/watch?v=remix",
      },
    ]);

    expect(selected?.id).toBe("remix");
  });

  it("still penalizes remixes when the query does not ask for one", () => {
    const selected = rankYoutubeCandidates("anuel aa sola", [
      {
        id: "original",
        title: "Anuel AA - Sola",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
      {
        id: "remix",
        title: "Anuel AA - Sola (Remix)",
        webpageUrl: "https://youtube.com/watch?v=remix",
      },
    ]);

    expect(selected?.id).toBe("original");
  });

  it("matches titles with small spelling differences", () => {
    const ranked = rankYoutubeCandidatesAll("make them pray", [
      {
        id: "pay",
        title: "Drake - Make Them Pay",
        webpageUrl: "https://youtube.com/watch?v=pay",
      },
      {
        id: "cry",
        title: "Make Them Cry",
        webpageUrl: "https://youtube.com/watch?v=cry",
      },
    ]);

    expect(ranked.map((candidate) => candidate.id)).toEqual(["pay"]);
  });

  it("credits the channel when it matches an artist term", () => {
    const selected = rankYoutubeCandidates("drake make them pay", [
      {
        channel: "Random Uploads",
        id: "reupload",
        title: "Make Them Pay (reupload)",
        webpageUrl: "https://youtube.com/watch?v=reupload",
      },
      {
        channel: "Drake",
        id: "channelMatch",
        title: "Make Them Pay",
        webpageUrl: "https://youtube.com/watch?v=channelMatch",
      },
    ]);

    expect(selected?.id).toBe("channelMatch");
  });
});

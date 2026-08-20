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

  it("prefers the studio version when the expected duration is known", () => {
    const selected = rankYoutubeCandidates(
      "duki rockstar",
      [
        {
          durationSeconds: 320,
          id: "live",
          title: "Duki - Rockstar (Live en el Estadio)",
          webpageUrl: "https://youtube.com/watch?v=live",
        },
        {
          durationSeconds: 182,
          id: "studio",
          title: "DUKI - Rockstar (Official Video)",
          webpageUrl: "https://youtube.com/watch?v=studio",
        },
      ],
      180,
    );

    expect(selected?.id).toBe("studio");
  });

  it("drops far-away durations from the ranked list", () => {
    const ranked = rankYoutubeCandidatesAll(
      "the weeknd starboy",
      [
        {
          durationSeconds: 600,
          id: "live",
          title: "The Weeknd - Starboy (Live)",
          webpageUrl: "https://youtube.com/watch?v=live",
        },
        {
          durationSeconds: 230,
          id: "song",
          title: "The Weeknd - Starboy",
          webpageUrl: "https://youtube.com/watch?v=song",
        },
      ],
      215,
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(["song"]);
  });

  it("does not penalize candidates without a known duration", () => {
    const selected = rankYoutubeCandidates(
      "duki rockstar",
      [
        {
          id: "plain",
          title: "Duki - Rockstar",
          webpageUrl: "https://youtube.com/watch?v=plain",
        },
        {
          durationSeconds: 700,
          id: "live",
          title: "Duki - Rockstar (Live)",
          webpageUrl: "https://youtube.com/watch?v=live",
        },
      ],
      180,
    );

    expect(selected?.id).toBe("plain");
  });

  it("rejects festival recordings with an event context in the title", () => {
    const selected = rankYoutubeCandidates(
      "kanye west kid cudi ghost town",
      [
        {
          id: "festival",
          title: "Ghost Town (Kids See Ghosts at Camp Flog Gnaw)",
          webpageUrl: "https://youtube.com/watch?v=festival",
        },
      ],
      271,
    );

    expect(selected).toBeUndefined();
  });

  it("prefers the studio upload over a festival recording", () => {
    const selected = rankYoutubeCandidates(
      "kanye west kid cudi ghost town",
      [
        {
          channel: "Random Fan Channel",
          id: "festival",
          title: "Ghost Town (Kids See Ghosts at Camp Flog Gnaw)",
          webpageUrl: "https://youtube.com/watch?v=festival",
        },
        {
          channel: "Kids See Ghosts - Topic",
          id: "studio",
          title: "Ghost Town",
          webpageUrl: "https://youtube.com/watch?v=studio",
        },
      ],
      271,
    );

    expect(selected?.id).toBe("studio");
  });

  it("prefers the original over a clean version", () => {
    const selected = rankYoutubeCandidates("duki rockstar", [
      {
        id: "clean",
        title: "Duki - Rockstar (Clean Version)",
        webpageUrl: "https://youtube.com/watch?v=clean",
      },
      {
        id: "original",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
    ]);

    expect(selected?.id).toBe("original");
  });

  it("keeps the clean version when the query asks for it", () => {
    const selected = rankYoutubeCandidates("duki rockstar clean", [
      {
        id: "original",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
      {
        id: "clean",
        title: "Duki - Rockstar (Clean)",
        webpageUrl: "https://youtube.com/watch?v=clean",
      },
    ]);

    expect(selected?.id).toBe("clean");
  });

  it("prefers the original over a bass boosted version", () => {
    const selected = rankYoutubeCandidates("duki rockstar", [
      {
        id: "boosted",
        title: "Duki - Rockstar [BASS BOOSTED]",
        webpageUrl: "https://youtube.com/watch?v=boosted",
      },
      {
        id: "original",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
    ]);

    expect(selected?.id).toBe("original");
  });

  it("keeps the bass boosted version when the query asks for it", () => {
    const selected = rankYoutubeCandidates("duki rockstar bass boosted", [
      {
        id: "original",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
      {
        id: "boosted",
        title: "Duki - Rockstar [BASS BOOSTED]",
        webpageUrl: "https://youtube.com/watch?v=boosted",
      },
    ]);

    expect(selected?.id).toBe("boosted");
  });

  it("prefers the original over an instrumental or 8d version", () => {
    const selected = rankYoutubeCandidates("the weeknd starboy", [
      {
        id: "instrumental",
        title: "The Weeknd - Starboy (Instrumental)",
        webpageUrl: "https://youtube.com/watch?v=instrumental",
      },
      {
        id: "eightd",
        title: "Starboy 8D",
        webpageUrl: "https://youtube.com/watch?v=eightd",
      },
      {
        id: "original",
        title: "The Weeknd - Starboy (Official Audio)",
        webpageUrl: "https://youtube.com/watch?v=original",
      },
    ]);

    expect(selected?.id).toBe("original");
  });

  it("prefers the original master over a lyric video", () => {
    const selected = rankYoutubeCandidates("duki rockstar", [
      {
        id: "lyrics",
        title: "Duki - Rockstar (Lyrics)",
        webpageUrl: "https://youtube.com/watch?v=lyrics",
      },
      {
        id: "official",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=official",
      },
    ]);

    expect(selected?.id).toBe("official");
  });

  it("plays the lyric video when no master is available", () => {
    const selected = rankYoutubeCandidates("duki rockstar", [
      {
        id: "lyrics",
        title: "Duki - Rockstar (Lyrics)",
        webpageUrl: "https://youtube.com/watch?v=lyrics",
      },
    ]);

    expect(selected?.id).toBe("lyrics");
  });

  it("keeps the lyric version when the query asks for it", () => {
    const selected = rankYoutubeCandidates("duki rockstar lyrics", [
      {
        id: "official",
        title: "DUKI - Rockstar (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=official",
      },
      {
        id: "lyrics",
        title: "Duki - Rockstar (Lyrics)",
        webpageUrl: "https://youtube.com/watch?v=lyrics",
      },
    ]);

    expect(selected?.id).toBe("lyrics");
  });

  it("does not penalize an event phrase the query asks for", () => {
    const selected = rankYoutubeCandidates(
      "ghost town kids see ghosts at camp flog gnaw",
      [
        {
          id: "festival",
          title: "Ghost Town (Kids See Ghosts at Camp Flog Gnaw)",
          webpageUrl: "https://youtube.com/watch?v=festival",
        },
      ],
    );

    expect(selected?.id).toBe("festival");
  });

  it("prefers the audio-length version over the longer official video", () => {
    const selected = rankYoutubeCandidates("imitadora romeo santos", [
      {
        channel: "Romeo Santos",
        durationSeconds: 236,
        id: "lyric",
        title: "Romeo Santos - Imitadora (Official Lyric Video)",
        webpageUrl: "https://youtube.com/watch?v=lyric",
      },
      {
        channel: "LatinHype",
        durationSeconds: 236,
        id: "audio",
        title: "Romeo Santos - Imitadora",
        webpageUrl: "https://youtube.com/watch?v=audio",
      },
      {
        channel: "Romeo Santos",
        durationSeconds: 298,
        id: "video",
        title: "Romeo Santos - Imitadora (Official Video)",
        webpageUrl: "https://youtube.com/watch?v=video",
      },
    ]);

    expect(selected?.id).toBe("lyric");
  });

  it("ignores noise words in the query like o or audio", () => {
    const selected = rankYoutubeCandidates(
      "imitadora lyrics official o audio",
      [
        {
          durationSeconds: 236,
          id: "lyric",
          title: "Romeo Santos - Imitadora (Official Lyric Video)",
          webpageUrl: "https://youtube.com/watch?v=lyric",
        },
        {
          durationSeconds: 298,
          id: "video",
          title: "Romeo Santos - Imitadora (Official Video)",
          webpageUrl: "https://youtube.com/watch?v=video",
        },
        {
          durationSeconds: 480,
          id: "unrelated",
          title: "Como hacer audio oficial tutorial",
          webpageUrl: "https://youtube.com/watch?v=unrelated",
        },
      ],
    );

    expect(selected?.id).toBe("lyric");
  });
});

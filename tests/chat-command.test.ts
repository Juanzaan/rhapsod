import { describe, expect, it } from "vitest";

import { parseChatCommand } from "../src/commands/chat-command.js";

describe("parseChatCommand", () => {
  it("parses commands and aliases", () => {
    expect(parseChatCommand("!p https://youtu.be/abc")).toEqual({
      input: "https://youtu.be/abc",
      name: "play",
    });
    expect(parseChatCommand("!np")).toEqual({ name: "now-playing" });
    expect(parseChatCommand("!now-playing")).toEqual({
      name: "now-playing",
    });
    expect(parseChatCommand("!loop queue")).toEqual({
      mode: "queue",
      name: "loop",
    });
    expect(parseChatCommand("!tone")).toEqual({ name: "test-tone" });
    expect(parseChatCommand("!shuffle")).toEqual({ name: "shuffle" });
    expect(parseChatCommand("!ly")).toEqual({ name: "lyrics" });
    expect(parseChatCommand("!lyrics")).toEqual({ name: "lyrics" });
    expect(parseChatCommand("!yt duki rockstar")).toEqual({
      input: "duki rockstar",
      name: "search",
    });
    expect(parseChatCommand("!yt 3 duki rockstar")).toEqual({
      index: 3,
      input: "duki rockstar",
      name: "search",
    });
    expect(parseChatCommand("!stats")).toEqual({ name: "stats" });
    expect(parseChatCommand("!st")).toEqual({ name: "stats" });
    expect(parseChatCommand("!hist")).toEqual({ name: "history" });
    expect(parseChatCommand("!pn duki rockstar")).toEqual({
      input: "duki rockstar",
      name: "playnext",
    });
  });

  it("does not treat normal chat as a command", () => {
    expect(parseChatCommand("play this please")).toBeUndefined();
  });

  it("unwraps URLs formatted by TeamSpeak chat", () => {
    expect(
      parseChatCommand(
        "!play [URL]https://www.youtube.com/watch?v=RqRBpGgC10g[/URL]",
      ),
    ).toEqual({
      input: "https://www.youtube.com/watch?v=RqRBpGgC10g",
      name: "play",
    });
    expect(
      parseChatCommand("!play [url=https://youtu.be/RqRBpGgC10g]YouTube[/url]"),
    ).toEqual({
      input: "https://youtu.be/RqRBpGgC10g",
      name: "play",
    });
  });

  it("validates numeric arguments and command usage", () => {
    expect(parseChatCommand("!volume 80")).toEqual({
      name: "volume",
      value: 80,
    });
    expect(parseChatCommand("!rm 3")).toEqual({
      from: 3,
      name: "remove",
      to: 3,
    });
    expect(parseChatCommand("!remove 2-5")).toEqual({
      from: 2,
      name: "remove",
      to: 5,
    });
    expect(parseChatCommand("!mv 5 2")).toEqual({
      from: 5,
      name: "move",
      to: 2,
    });
    expect(parseChatCommand("!queue 3")).toEqual({ name: "queue", page: 3 });
    expect(() => parseChatCommand("!volume 101")).toThrow("between 0 and 100");
    expect(() => parseChatCommand("!play")).toThrow("Usage: !play");
    expect(() => parseChatCommand("!playnext")).toThrow("Usage: !playnext");
    expect(() => parseChatCommand("!remove 5-2")).toThrow("ascending");
    expect(() => parseChatCommand("!move 2")).toThrow("Usage: !move");
    expect(() => parseChatCommand("!queue 0")).toThrow("at least 1");
    expect(() => parseChatCommand("!unknown")).toThrow("Unknown command");
  });
});

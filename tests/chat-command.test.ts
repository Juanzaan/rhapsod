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
    expect(parseChatCommand("!diag")).toEqual({ name: "diag" });
    expect(parseChatCommand("!hist")).toEqual({ name: "history" });
    expect(parseChatCommand("!pn duki rockstar")).toEqual({
      input: "duki rockstar",
      name: "playnext",
    });
    expect(parseChatCommand("!seek 90")).toEqual({
      name: "seek",
      seconds: 90,
    });
    expect(parseChatCommand("!previous")).toEqual({ name: "previous" });
    expect(parseChatCommand("!prev")).toEqual({ name: "previous" });
    expect(parseChatCommand("!channel-move General")).toEqual({
      input: "General",
      name: "channel-move",
    });
    expect(parseChatCommand("!ch gaming")).toEqual({
      input: "gaming",
      name: "channel-move",
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
    expect(parseChatCommand("!mv 2 5")).toEqual({
      from: 2,
      name: "move",
      to: 5,
    });
    expect(parseChatCommand("!queue 3")).toEqual({ name: "queue", page: 3 });
    expect(() => parseChatCommand("!volume 101")).toThrow(
      "El volumen tiene que estar entre 0 y 100",
    );
    expect(() => parseChatCommand("!play")).toThrow("Usá: !play");
    expect(() => parseChatCommand("!playnext")).toThrow("Usá: !playnext");
    expect(() => parseChatCommand("!remove 5-2")).toThrow(
      "El rango tiene que ser ascendente",
    );
    expect(() => parseChatCommand("!move 2")).toThrow("Usá: !move");
    expect(() => parseChatCommand("!queue 0")).toThrow(
      "La posición tiene que ser mayor a 0",
    );
    expect(() => parseChatCommand("!seek abc")).toThrow("Usá: !seek");
    expect(() => parseChatCommand("!previous 2")).toThrow(
      "no acepta argumentos",
    );
    expect(() => parseChatCommand("!unknown")).toThrow(/No reconozco/);
    expect(() => parseChatCommand("!channel-move")).toThrow(
      "Usá: !channel-move",
    );
  });

  it("parses audio filter commands and aliases", () => {
    expect(parseChatCommand("!bassboost")).toEqual({ name: "bassboost" });
    expect(parseChatCommand("!bassboost 4")).toEqual({
      name: "bassboost",
      level: 4,
    });
    expect(parseChatCommand("!bb")).toEqual({ name: "bassboost" });
    expect(parseChatCommand("!nightcore")).toEqual({ name: "nightcore" });
    expect(parseChatCommand("!nightcore 1.25")).toEqual({
      name: "nightcore",
      rate: 1.25,
    });
    expect(parseChatCommand("!nc")).toEqual({ name: "nightcore" });
    expect(parseChatCommand("!vaporwave")).toEqual({ name: "vaporwave" });
    expect(parseChatCommand("!vaporwave 0.9")).toEqual({
      name: "vaporwave",
      rate: 0.9,
    });
    expect(parseChatCommand("!vw")).toEqual({ name: "vaporwave" });
    expect(parseChatCommand("!8d")).toEqual({ name: "8d" });
    expect(parseChatCommand("!filter")).toEqual({ name: "filter" });
    expect(parseChatCommand("!filter off")).toEqual({
      name: "filter",
      off: true,
    });
  });

  it("rejects invalid audio filter parameters", () => {
    expect(() => parseChatCommand("!bassboost 9")).toThrow("Usá: !bassboost");
    expect(() => parseChatCommand("!bassboost abc")).toThrow(
      "Usá: !bassboost",
    );
    expect(() => parseChatCommand("!nightcore 3")).toThrow(
      "Usá: !nightcore",
    );
    expect(() => parseChatCommand("!vaporwave 0.5")).toThrow(
      "Usá: !vaporwave",
    );
    expect(() => parseChatCommand("!8d 5")).toThrow("no acepta argumentos");
    expect(() => parseChatCommand("!filter custom")).toThrow(
      "Usá: !filter",
    );
  });
});

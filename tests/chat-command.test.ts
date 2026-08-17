import { describe, expect, it } from "vitest";

import { parseChatCommand } from "../src/commands/chat-command.js";

describe("parseChatCommand", () => {
  it("parses commands and aliases", () => {
    expect(parseChatCommand("!p https://youtu.be/abc")).toEqual({
      input: "https://youtu.be/abc",
      name: "play",
    });
    expect(parseChatCommand("!np")).toEqual({ name: "now-playing" });
    expect(parseChatCommand("!loop queue")).toEqual({
      mode: "queue",
      name: "loop",
    });
    expect(parseChatCommand("!tone")).toEqual({ name: "test-tone" });
  });

  it("does not treat normal chat as a command", () => {
    expect(parseChatCommand("play this please")).toBeUndefined();
  });

  it("validates numeric arguments and command usage", () => {
    expect(parseChatCommand("!volume 80")).toEqual({
      name: "volume",
      value: 80,
    });
    expect(parseChatCommand("!rm 3")).toEqual({ name: "remove", position: 3 });
    expect(() => parseChatCommand("!volume 101")).toThrow("between 0 and 100");
    expect(() => parseChatCommand("!play")).toThrow("Usage: !play");
    expect(() => parseChatCommand("!unknown")).toThrow("Unknown command");
  });
});

import { describe, expect, it } from "vitest";

import { parseChatCommand } from "../src/commands/chat-command.js";
import {
  COMMAND_SPECS,
  formatHelpCategory,
  formatHelpMenu,
  lookupCommandName,
  resolveHelpCategory,
} from "../src/commands/command-registry.js";

describe("command registry", () => {
  it("covers every ChatCommand name exactly once", () => {
    const unionNames = new Set<string>();
    for (const spec of COMMAND_SPECS) {
      expect(unionNames.has(spec.name), `duplicate name ${spec.name}`).toBe(
        false,
      );
      unionNames.add(spec.name);
    }
    for (const name of unionNames) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("has unique non-colliding aliases", () => {
    const seen = new Map<string, string>();
    for (const spec of COMMAND_SPECS) {
      expect(lookupCommandName(spec.name)).toBe(spec.name);
      for (const alias of spec.aliases) {
        const existing = seen.get(alias);
        expect(existing, `alias ${alias} reused`).toBeUndefined();
        seen.set(alias, spec.name);
        expect(lookupCommandName(alias)).toBe(spec.name);
      }
    }
  });

  it("every alias parses to its canonical command", () => {
    const sampleArgs: Readonly<Record<string, string>> = {
      play: " x",
      playnext: " x",
      search: " x",
      "channel-move": " 123",
      move: " 1 2",
      remove: " 1",
      seek: " 30",
      volume: " 50",
      bassboost: " 2",
      nightcore: " 1.2",
      vaporwave: " 0.9",
      loop: " off",
      playlist: " list",
    };
    for (const spec of COMMAND_SPECS) {
      for (const alias of spec.aliases) {
        const suffix = sampleArgs[spec.name] ?? "";
        const parsed = parseChatCommand(`!${alias}${suffix}`);
        expect(parsed?.name, `alias !${alias}`).toBe(spec.name);
      }
    }
  });

  it("shows a menu of 4 categories when !help has no argument", () => {
    const menu = formatHelpMenu(false);
    expect(menu).toContain("Comandos disponibles");
    expect(menu).toContain("!help 1");
    expect(menu).toContain("!help 2");
    expect(menu).toContain("!help 3");
    expect(menu).toContain("!help 4");
    expect(menu).toContain("Reproducción");
    expect(menu).toContain("Cola");
    expect(menu).toContain("Administración");
    expect(menu).toContain("Otros");
    expect(menu).toContain("!help 2 para ver");
  });

  it("resolves help categories by number and by name", () => {
    expect(resolveHelpCategory("1")).toBe("music");
    expect(resolveHelpCategory("2")).toBe("queue");
    expect(resolveHelpCategory("3")).toBe("admin");
    expect(resolveHelpCategory("4")).toBe("misc");
    expect(resolveHelpCategory("reproduccion")).toBe("music");
    expect(resolveHelpCategory("cola")).toBe("queue");
    expect(resolveHelpCategory("admin")).toBe("admin");
    expect(resolveHelpCategory("otros")).toBe("misc");
    expect(resolveHelpCategory("9")).toBeUndefined();
    expect(resolveHelpCategory("x")).toBeUndefined();
    expect(resolveHelpCategory(undefined)).toBeUndefined();
  });

  it("formats a category with its commands", () => {
    const music = formatHelpCategory("music", false);
    expect(music).toContain("Reproducción:");
    expect(music).toContain("!play <URL o búsqueda>");
    expect(music).toContain("!skip");
    expect(music).toContain("!help para volver");

    const admin = formatHelpCategory("admin", true);
    expect(admin).toContain("Administración:");
    expect(admin).toContain("!debug-server");
    expect(admin).toContain("!diag");
  });

  it("hides admin commands from non-admins in their category", () => {
    const adminForRegular = formatHelpCategory("admin", false);
    expect(adminForRegular).toContain("No hay comandos");
    const adminForAdmin = formatHelpCategory("admin", true);
    expect(adminForAdmin).toContain("!debug-server");
  });

  it("parses !help with a category argument", () => {
    expect(parseChatCommand("!help")).toEqual({ name: "help" });
    expect(parseChatCommand("!help 2")).toEqual({
      category: "queue",
      name: "help",
    });
    expect(parseChatCommand("!h cola")).toEqual({
      category: "queue",
      name: "help",
    });
    expect(() => parseChatCommand("!help 9")).toThrow(/Usá: !help/);
    expect(() => parseChatCommand("!help xyz")).toThrow(/Usá: !help/);
  });
});

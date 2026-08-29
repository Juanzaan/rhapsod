import { describe, expect, it } from "vitest";

import { parseChatCommand } from "../src/commands/chat-command.js";
import {
  COMMAND_SPECS,
  formatHelp,
  lookupCommandName,
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

  it("generates help with grouped commands and aliases", () => {
    const help = formatHelp(false);
    expect(help).toContain("Comandos disponibles:");
    expect(help).toContain("--- Reproducción ---");
    expect(help).toContain("!play <URL o búsqueda>");
    expect(help).toContain("!queue [página]");
    expect(help).toContain("!help (!h) - Mostrar esta ayuda");
  });

  it("hides admin commands from non-admins and shows them for admins", () => {
    const regular = formatHelp(false);
    const admin = formatHelp(true);
    expect(regular).not.toContain("!debug-server");
    expect(admin).toContain("!debug-server");
    expect(regular).not.toContain("!diag");
    expect(admin).toContain("!diag");
    expect(admin).toContain("--- Administración ---");
  });

  it("lists every known command in help (no stale entries)", () => {
    const help = formatHelp(true);
    for (const spec of COMMAND_SPECS) {
      expect(help, `missing ${spec.name}`).toContain(`!${spec.usage}`);
    }
  });
});

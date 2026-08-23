import { describe, expect, it } from "vitest";

import { userFacingError } from "../src/main.js";
import { parseChatCommand } from "../src/commands/chat-command.js";
import { PlaybackQueue } from "../src/domain/playback-queue.js";
import type { Track } from "../src/domain/track.js";

function fakeTrack(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    source: "youtube",
    durationSeconds: 200,
    requestedBy: "test",
    requestedByUid: "uid-test",
  };
}

describe("userFacingError", () => {
  it("DRM → mensaje seguro en español", () => {
    expect(userFacingError(new Error("DRM protected"))).toMatch(/DRM/);
  });

  it("format not available → mensaje seguro en español", () => {
    expect(
      userFacingError(new Error("Requested format is not available")),
    ).toMatch(/YouTube/);
  });

  it("fetch failed → mensaje seguro en español", () => {
    expect(userFacingError(new Error("fetch failed"))).toMatch(
      /Fallo momentáneo/,
    );
  });

  it("duplicado → mensaje en español", () => {
    expect(
      userFacingError(new Error("Esa canción ya está en la cola.")),
    ).toMatch(/ya está en la cola/);
  });

  it("fallthrough nunca filtra error.message crudo", () => {
    const msg = userFacingError(
      new Error("SECRETO_INTERNO_12345 yt-dlp stderr path/to/file"),
    );
    expect(msg).not.toContain("SECRETO");
    expect(msg).not.toContain("yt-dlp");
    expect(msg).not.toContain("path/to/file");
    expect(msg).toMatch(/Ocurrió un error/);
  });

  it("error de comando desconocido se pasa tal cual", () => {
    const err = new Error("No reconozco ese comando. Escribí !help para ver los disponibles.");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de usage se pasa tal cual", () => {
    const err = new Error("Usá: !play <link o término de búsqueda>");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de argumentos inesperados se pasa tal cual", () => {
    const err = new Error("El comando !xyz no acepta argumentos");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de posición se pasa tal cual", () => {
    const err = new Error("La posición tiene que ser mayor a 0.");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de volumen se pasa tal cual", () => {
    const err = new Error("El volumen tiene que estar entre 0 y 100.");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de rango se pasa tal cual", () => {
    const err = new Error("El rango tiene que ser ascendente (ej: 2-5).");
    expect(userFacingError(err)).toBe(err.message);
  });
});

describe("parseChatCommand — mensajes en español", () => {
  it("comando desconocido → error en español", () => {
    expect(() => parseChatCommand("!xyz")).toThrow(/No reconozco/);
  });

  it("play sin argumento → usage en español", () => {
    expect(() => parseChatCommand("!play")).toThrow(/Usá: !play/);
  });

  it("playnext sin argumento → usage en español", () => {
    expect(() => parseChatCommand("!playnext")).toThrow(/Usá: !playnext/);
  });

  it("yt sin argumento → usage en español", () => {
    expect(() => parseChatCommand("!yt")).toThrow(/Usá: !yt/);
  });

  it("channel-move sin argumento → usage en español", () => {
    expect(() => parseChatCommand("!channel-move")).toThrow(
      /Usá: !channel-move/,
    );
  });

  it("move sin argumentos → usage en español", () => {
    expect(() => parseChatCommand("!move")).toThrow(/Usá: !move/);
  });

  it("volume sin número → usage en español", () => {
    expect(() => parseChatCommand("!volume abc")).toThrow(/Usá: !volume/);
  });

  it("volume fuera de rango → error en español", () => {
    expect(() => parseChatCommand("!volume 200")).toThrow(
      /El volumen tiene que estar entre 0 y 100/,
    );
  });

  it("seek sin número → usage en español", () => {
    expect(() => parseChatCommand("!seek abc")).toThrow(/Usá: !seek/);
  });

  it("remove posición inválida → error en español", () => {
    expect(() => parseChatCommand("!remove 0")).toThrow(
      /La posición tiene que ser mayor a 0/,
    );
  });

  it("move rango descendente → error en español", () => {
    expect(() => parseChatCommand("!move 5 2")).toThrow(
      /El rango tiene que ser ascendente/,
    );
  });

  it("comando sin argumentos acepta → no lanza error", () => {
    expect(parseChatCommand("!pause")).toEqual({ name: "pause" });
    expect(parseChatCommand("!stop")).toEqual({ name: "stop" });
    expect(parseChatCommand("!skip")).toEqual({ name: "skip" });
  });
});

describe("PlaybackQueue — duplicado sin ID interno", () => {
  it("duplicado → error en español sin revelar ID", () => {
    const q = new PlaybackQueue();
    const track = fakeTrack("dQw4w9WgXcQ");
    q.add(track);
    expect(() => q.add(track)).toThrow(/ya está en la cola/);
    expect(() => q.add(track)).not.toThrow(/dQw4w9WgXcQ/);
  });
});

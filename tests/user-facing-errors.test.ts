import { describe, expect, it } from "vitest";

import { userFacingError } from "../src/main.js";
import { parseChatCommand } from "../src/commands/chat-command.js";
import { PlaybackQueue } from "../src/domain/playback-queue.js";
import { UserError } from "../src/lib/user-error.js";
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
    const err = new UserError(
      "No reconozco ese comando. Escribí !help para ver los disponibles.",
    );
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de usage se pasa tal cual", () => {
    const err = new UserError("Usá: !play <link o término de búsqueda>");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de argumentos inesperados se pasa tal cual", () => {
    const err = new UserError("El comando !xyz no acepta argumentos");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de posición se pasa tal cual", () => {
    const err = new UserError("La posición tiene que ser mayor a 0.");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de volumen se pasa tal cual", () => {
    const err = new UserError("El volumen tiene que estar entre 0 y 100.");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("error de rango se pasa tal cual", () => {
    const err = new UserError("El rango tiene que ser ascendente (ej: 2-5).");
    expect(userFacingError(err)).toBe(err.message);
  });

  it("save con cola vacía muestra el mensaje de playlist", () => {
    const msg = "La cola está vacía: no hay nada para guardar en la playlist.";
    expect(userFacingError(new UserError(msg))).toBe(msg);
  });

  it("load de playlist inexistente muestra el mensaje", () => {
    const msg = 'No encontré la playlist "fiesta".';
    expect(userFacingError(new UserError(msg))).toBe(msg);
  });

  it("límite de playlists muestra el mensaje", () => {
    const msg = "Límite de 20 playlists por usuario.";
    expect(userFacingError(new UserError(msg))).toBe(msg);
  });

  it("límite de tracks muestra el mensaje", () => {
    const msg = "Una playlist no puede tener más de 200 pistas.";
    expect(userFacingError(new UserError(msg))).toBe(msg);
  });

  it("playlists no configuradas muestra el mensaje", () => {
    const msg = "Las playlists no están configuradas en este bot.";
    expect(userFacingError(new UserError(msg))).toBe(msg);
  });

  it("los errores esperados de playlists nunca caen al genérico", () => {
    const messages = [
      "La cola está vacía: no hay nada para guardar en la playlist.",
      'No encontré la playlist "fiesta".',
      "Límite de 20 playlists por usuario.",
      "Una playlist no puede tener más de 200 pistas.",
      "Las playlists no están configuradas en este bot.",
    ];
    for (const message of messages) {
      expect(userFacingError(new UserError(message))).toBe(message);
    }
  });

  it("UserError pasa su mensaje tal cual", () => {
    expect(userFacingError(new UserError("La playlist está vacía."))).toBe(
      "La playlist está vacía.",
    );
    expect(
      userFacingError(
        new UserError("No hay nada reproduciéndose para saltar de posición."),
      ),
    ).toBe("No hay nada reproduciéndose para saltar de posición.");
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

  it("move descendente → permite subir una pista", () => {
    expect(parseChatCommand("!move 5 2")).toEqual({
      name: "move",
      from: 5,
      to: 2,
    });
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

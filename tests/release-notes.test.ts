import { describe, expect, it } from "vitest";
import {
  loadRelease,
  renderRelease,
  validateNotes,
} from "../scripts/release-notes.mjs";

const english =
  "## Summary\n\nA release.\n\n## Changes\n\n- A fix.\n\n## Upgrade\n\nRun npm ci.\n\n## Verification\n\nCheck playback.\n";
const spanish =
  "## Resumen\n\nUna versión.\n\n## Cambios\n\n- Una corrección.\n\n## Actualización\n\nEjecutar npm ci.\n\n## Verificación\n\nComprobar la reproducción.\n";

describe("release notes", () => {
  it("refuses to substitute pending notes for an unknown release", () => {
    expect(() => loadRelease("v99.0.0")).toThrow("No archived release notes");
  });

  it("loads an archived release without relative language links", () => {
    const body = loadRelease("v3.0.0");
    expect(body).toContain("## Summary");
    expect(body).toContain("## Resumen");
    expect(body).not.toContain("](v3.0.0");
  });
  it("renders both languages with version-pinned links and the exact baseline", () => {
    const body = renderRelease("v3.1.0", english, spanish, "v3.0.0");
    expect(body).toContain(english.trim());
    expect(body).toContain(spanish.trim());
    expect(body).toContain("/compare/v3.0.0...v3.1.0");
    expect(body).toContain("/tree/v3.1.0/docs");
    expect(body).not.toContain("/main/");
  });

  it("links the first release to its source instead of inventing a baseline", () => {
    const body = renderRelease("v1.0.0", english, spanish);
    expect(body).toContain("/tree/v1.0.0)");
    expect(body).not.toContain("/compare/");
  });

  it.each(["v3.0.0/../../main", "main", "3.0.0"])(
    "rejects invalid tag %s",
    (tag) => {
      expect(() => renderRelease(tag, english, spanish)).toThrow(
        "Invalid release tag",
      );
    },
  );

  it("rejects missing, empty, duplicate and unfinished sections", () => {
    for (const content of [
      "## Summary\nTitle only",
      english.replace("A release.", ""),
      `${english}\n## Changes\nAgain`,
      english.replace("A fix.", "TODO"),
    ]) {
      expect(() => validateNotes(content, "en")).toThrow();
    }
  });
});

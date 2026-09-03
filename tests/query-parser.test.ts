import { describe, expect, it } from "vitest";

import { parseMusicQuery } from "../src/lib/query-parser.js";

describe("parseMusicQuery", () => {
  it("parses 'Artist - Title' with dash separator", () => {
    const result = parseMusicQuery("The Weeknd - Blinding Lights");
    expect(result.artist).toBe("The Weeknd");
    expect(result.title).toBe("Blinding Lights");
    expect(result.confidence).toBe("high");
  });

  it("parses 'Artist – Title' with en-dash", () => {
    const result = parseMusicQuery("The Weeknd – Blinding Lights");
    expect(result.artist).toBe("The Weeknd");
    expect(result.title).toBe("Blinding Lights");
    expect(result.confidence).toBe("high");
  });

  it("parses 'Artist - Title (feat. Someone)'", () => {
    const result = parseMusicQuery("Duki - Rockstar (feat. Tiago PZK)");
    expect(result.artist).toBe("Duki");
    expect(result.title).toContain("Rockstar");
    expect(result.confidence).toBe("high");
  });

  it("parses 'Title ft. Artist'", () => {
    const result = parseMusicQuery("Rockstar ft. Tiago PZK");
    expect(result.artist).toBe("Rockstar");
    expect(result.title).toBe("Tiago PZK");
    expect(result.confidence).toBe("medium");
  });

  it("parses 'Artist: Title' with colon", () => {
    const result = parseMusicQuery("Queen: Bohemian Rhapsody");
    expect(result.artist).toBe("Queen");
    expect(result.title).toBe("Bohemian Rhapsody");
    expect(result.confidence).toBe("medium");
  });

  it("parses two words as artist-title (low confidence)", () => {
    const result = parseMusicQuery("Duki Rockstar");
    expect(result.artist).toBe("Duki");
    expect(result.title).toBe("Rockstar");
    expect(result.confidence).toBe("low");
  });

  it("parses two-word title as artist-title (low confidence)", () => {
    const result = parseMusicQuery("Blinding Lights");
    expect(result.artist).toBe("Blinding");
    expect(result.title).toBe("Lights");
    expect(result.confidence).toBe("low");
  });

  it("parses single word as title only", () => {
    const result = parseMusicQuery("Hello");
    expect(result.artist).toBeUndefined();
    expect(result.title).toBe("Hello");
    expect(result.confidence).toBe("low");
  });

  it("removes cruft: (Official Video)", () => {
    const result = parseMusicQuery(
      "The Weeknd - Blinding Lights (Official Video)",
    );
    expect(result.artist).toBe("The Weeknd");
    expect(result.title).toBe("Blinding Lights");
  });

  it("removes cruft: [4K]", () => {
    const result = parseMusicQuery("The Weeknd - Blinding Lights [4K]");
    expect(result.artist).toBe("The Weeknd");
    expect(result.title).toBe("Blinding Lights");
  });

  it("removes cruft: (Lyrics)", () => {
    const result = parseMusicQuery("Adele - Hello (Lyrics)");
    expect(result.artist).toBe("Adele");
    expect(result.title).toBe("Hello");
  });

  it("throws on empty query", () => {
    expect(() => parseMusicQuery("")).toThrow(
      "La query de búsqueda no puede estar vacía.",
    );
  });

  it("throws on whitespace-only query", () => {
    expect(() => parseMusicQuery("   ")).toThrow(
      "La query de búsqueda no puede estar vacía.",
    );
  });

  it("preserves original input", () => {
    const input = "The Weeknd - Blinding Lights";
    const result = parseMusicQuery(input);
    expect(result.original).toBe(input);
  });

  it("strips leading Spanish article 'el'", () => {
    const result = parseMusicQuery("el que se fue");
    // After stripping "el": "que se fue" (3 words) → no 2-word parser → fallback
    expect(result.title).toBe("que se fue");
  });

  it("strips leading Spanish article 'la'", () => {
    const result = parseMusicQuery("la casa de papel");
    expect(result.title).toBe("casa de papel");
  });

  it("strips leading German article 'der'", () => {
    const result = parseMusicQuery("der künstler");
    expect(result.title).toBe("künstler");
  });

  it("strips leading French article 'le'", () => {
    const result = parseMusicQuery("le chanteur");
    expect(result.title).toBe("chanteur");
  });

  it("strips leading Italian article 'il'", () => {
    const result = parseMusicQuery("il cantante");
    expect(result.title).toBe("cantante");
  });

  it("strips leading Portuguese article 'um'", () => {
    const result = parseMusicQuery("um dia normal");
    // After stripping "um": "dia normal" → tryParseTwoWords: artist="dia", title="normal"
    expect(result.artist).toBe("dia");
    expect(result.title).toBe("normal");
  });

  it("does NOT strip words that are content (sin is not a stopword)", () => {
    const result = parseMusicQuery("sin ti");
    // tryParseTwoWords splits 2-word queries: artist="sin", title="ti"
    expect(result.artist).toBe("sin");
    expect(result.title).toBe("ti");
  });

  it("strips non-leading stopword 'el' and re-parses remaining", () => {
    const result = parseMusicQuery("mi vida el");
    // "el" is stripped → "mi vida" → tryParseTwoWords splits into artist="mi", title="vida"
    expect(result.artist).toBe("mi");
    expect(result.title).toBe("vida");
  });

  it("does NOT strip English 'the' (part of artist names like The Weeknd)", () => {
    const result = parseMusicQuery("The Weeknd - Blinding Lights");
    expect(result.artist).toBe("The Weeknd");
    expect(result.title).toBe("Blinding Lights");
  });
});

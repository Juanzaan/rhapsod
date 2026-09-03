export interface ParsedQuery {
  readonly artist?: string;
  readonly title: string;
  readonly original: string;
  readonly confidence: "high" | "medium" | "low";
}

const CRUFT_PATTERNS: readonly RegExp[] = [
  /\(official (video|audio|music video|lyric video|visualizer)\)/gi,
  /\[official (video|audio|music video|lyric video|visualizer)\]/gi,
  /\(lyrics?\)/gi,
  /\[lyrics?\]/gi,
  /\(lyric video\)/gi,
  /\[lyric video\]/gi,
  /\(visualizer\)/gi,
  /\[visualizer\]/gi,
  /\(audio\)/gi,
  /\[audio\]/gi,
  /\(music video\)/gi,
  /\[music video\]/gi,
  /\[mv\]/gi,
  /\(mv\)/gi,
  /\(hd\)/gi,
  /\[hd\]/gi,
  /\(4k\)/gi,
  /\[4k\]/gi,
  /\(8k\)/gi,
  /\[8k\]/gi,
  /\(sped up\)/gi,
  /\[sped up\]/gi,
  /\(slowed\)/gi,
  /\[slowed\]/gi,
  /\(nightcore\)/gi,
  /\[nightcore\]/gi,
  /provided to youtube by[^)]*\)/gi,
  /\(feat\.?\s*[^)]+\)/gi,
  /\(ft\.?\s*[^)]+\)/gi,
  /\(with\s+[^)]+\)/gi,
  /&\s+/g,
  /\bvs\.?\s+/gi,
  /♪/g,
  /♫/g,
  /★/g,
  /♪/gu,
  /♫/gu,
];

const SEPARATOR_PATTERN = /\s*[-–—]\s*/;
const FEAT_PATTERNS: readonly RegExp[] = [
  /\s+(?:feat\.?|ft\.?|featuring|with)\s+/i,
  /\s+(?:vs\.?|versus)\s+/i,
  /\s+x\s+/i,
];

function cleanCruft(input: string): string {
  let result = input;
  for (const pattern of CRUFT_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

const UNIVERSAL_FILLER_WORDS = new Set([
  // Articles across Romance and Germanic languages (NOT English "the/a/an" — commonly part of artist names)
  "el",
  "la",
  "los",
  "las",
  "lo",
  "un",
  "una",
  "unos",
  "unas",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "il",
  "lo",
  "i",
  "un",
  "uno",
  "una",
  "um",
  "ein",
  "un",
  "une",
  "le",
  "les",
]);

function stripFillerWords(input: string): string {
  const words = input.split(/\s+/);
  const filtered = words.filter(
    (w) => !UNIVERSAL_FILLER_WORDS.has(w.toLowerCase()),
  );
  return filtered.join(" ").trim();
}

function tryParseSeparator(cleaned: string): ParsedQuery | null {
  const parts = cleaned.split(SEPARATOR_PATTERN);
  if (parts.length >= 2 && parts[0] !== undefined && parts[1] !== undefined) {
    const artist = parts[0].trim();
    const title = parts.slice(1).join(" - ").trim();
    if (artist.length > 0 && title.length > 0) {
      return {
        artist,
        title,
        original: cleaned,
        confidence: "high",
      };
    }
  }
  return null;
}

function tryParseColon(cleaned: string): ParsedQuery | null {
  const match = cleaned.match(/^(.+?)[：:]\s*(.+)$/);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    const artist = match[1].trim();
    const title = match[2].trim();
    if (artist.length > 0 && title.length > 0) {
      return {
        artist,
        title,
        original: cleaned,
        confidence: "medium",
      };
    }
  }
  return null;
}

function tryParseFeat(cleaned: string): ParsedQuery | null {
  for (const pattern of FEAT_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match?.index !== undefined) {
      const before = cleaned.slice(0, match.index).trim();
      const after = cleaned.slice(match.index + match[0].length).trim();
      if (before.length > 0 && after.length > 0) {
        return {
          artist: before,
          title: after,
          original: cleaned,
          confidence: "medium",
        };
      }
    }
  }
  return null;
}

function tryParseTwoWords(cleaned: string): ParsedQuery | null {
  const words = cleaned.split(/\s+/);
  if (words.length === 2 && words[0] !== undefined && words[1] !== undefined) {
    return {
      artist: words[0],
      title: words[1],
      original: cleaned,
      confidence: "low",
    };
  }
  return null;
}

function tryParseTrailingArtist(cleaned: string): ParsedQuery | null {
  const words = cleaned.split(/\s+/);
  if (words.length < 4 || words.length > 5) return null;
  // 4-5 words: "my bad bro fimiguerrero" -> title "my bad bro", artist "fimiguerrero"
  const artist1 = words[words.length - 1]!;
  const title1 = words.slice(0, -1).join(" ");
  if (
    title1.length >= 4 &&
    artist1.length >= 3 &&
    artist1.length <= 20 &&
    !/^\d+$/.test(artist1)
  ) {
    const titleWordCount = title1.split(/\s+/).length;
    if (titleWordCount >= 2 && titleWordCount <= 4) {
      return {
        artist: artist1,
        title: title1,
        original: cleaned,
        confidence: "low",
      };
    }
  }
  if (words.length === 4) {
    const artist2 = words.slice(-2).join(" ");
    const title2 = words.slice(0, -2).join(" ");
    if (
      title2.length >= 4 &&
      artist2.length >= 5 &&
      title2.split(/\s+/).length === 2 &&
      artist2.split(/\s+/).every((w) => w.length >= 3)
    ) {
      return {
        artist: artist2,
        title: title2,
        original: cleaned,
        confidence: "low",
      };
    }
  }
  return null;
}

export function parseMusicQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("La query de búsqueda no puede estar vacía.");
  }

  const cleaned = cleanCruft(trimmed);
  const stripped = stripFillerWords(cleaned);

  return (
    tryParseSeparator(stripped) ||
    tryParseColon(stripped) ||
    tryParseFeat(stripped) ||
    tryParseTwoWords(stripped) ||
    tryParseTrailingArtist(stripped) || {
      title: stripped,
      original: trimmed,
      confidence: "low",
    }
  );
}

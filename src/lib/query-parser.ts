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

export function parseMusicQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error("La query de búsqueda no puede estar vacía.");
  }

  const cleaned = cleanCruft(trimmed);

  return (
    tryParseSeparator(cleaned) ||
    tryParseColon(cleaned) ||
    tryParseFeat(cleaned) ||
    tryParseTwoWords(cleaned) || {
      title: cleaned,
      original: trimmed,
      confidence: "low",
    }
  );
}

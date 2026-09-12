export function validateNotes(content: string, language: "en" | "es"): void;
export function loadRelease(tag: string): string;
export function renderRelease(
  tag: string,
  english: string,
  spanish: string,
  previous?: string,
): string;

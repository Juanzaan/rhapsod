export function formatPlaybackStarted(title: string, isFirst: boolean): string {
  return isFirst ? `Reproduciendo: ${title}` : `Ahora: ${title}`;
}

export function formatPlaybackError(title: string): string {
  const truncated = title.length > 40 ? `${title.slice(0, 39)}\u2026` : title;
  return `No pude reproducir "${truncated}". Se intentar\u00e1 continuar con la siguiente canci\u00f3n.`;
}

export interface PosterStats {
  number: number;
  visits: number;
  lastVisitedAt: number;
}

export interface PosterStatsPage {
  items: PosterStats[];
  nextCursor: number | null;
}

/** Canonical NFC paths; query parameters never select a different poster. */
export function posterNumber(path: string): number | null {
  const match = /^\/([1-9][0-9]{0,4})\/?$/.exec(path);
  return match ? Number(match[1]) : null;
}

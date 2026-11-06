/** Server-only, transactionally maintained collection pages. Never used to authorize commands. */
export const PROJECTED_COLLECTIONS: Readonly<Record<string, number>> = {
  teams: 41,
  members: 501,
  projectUpdates: 301,
  submissions: 41,
};
export interface ProjectionManifest {
  schema: 1;
  chunks: number;
  count: number;
}
export interface ProjectionRow {
  path: string;
  value: unknown;
}
export function projectionFor(path: string) {
  const match = /^(events\/[^/]+)\/([^/]+)$/.exec(path);
  if (!match || !PROJECTED_COLLECTIONS[match[2]!]) return null;
  return { path: `${match[1]}/readViews/${match[2]}`, limit: PROJECTED_COLLECTIONS[match[2]!]! };
}
/** Keep ample headroom under Firestore's 1 MiB document limit, including UTF-8 text. */
export function projectionChunks(rows: ProjectionRow[]): ProjectionRow[][] {
  const chunks: ProjectionRow[][] = [];
  let current: ProjectionRow[] = [],
    size = 0;
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (current.length && (size + bytes > 200_000 || current.length >= 100)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

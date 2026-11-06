import { describe, expect, it } from 'vitest';
import { projectionChunks, projectionFor } from '../apps/functions/src/read-projections';
describe('server read projections', () => {
  it('never projects authorization documents, money, messages or arbitrary paths', () => {
    for (const path of [
      'events/e/members/u',
      'events/e/roundAllocations',
      'events/e/conversations',
      'events/e/judgingSheets',
      'members',
      'events/e/teams/t/members',
    ])
      expect(projectionFor(path)).toBeNull();
    expect(projectionFor('events/e/members')?.limit).toBe(501);
  });
  it('bounds both UTF-8 document size and row count without losing or duplicating rows', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      path: `teams/${i}`,
      value: { text: '🙂'.repeat(1200) },
    }));
    const chunks = projectionChunks(rows);
    expect(chunks.flat()).toEqual(rows);
    for (const rows of chunks) {
      expect(rows.length).toBeLessThanOrEqual(100);
      expect(Buffer.byteLength(JSON.stringify({ rows }))).toBeLessThan(210_000);
    }
  });
});

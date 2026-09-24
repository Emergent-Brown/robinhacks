import { describe, expect, it } from 'vitest';
import type { GeneralMessage, MessagePage } from '@robinhacks/core';
import { mergeMessagePages } from '../apps/web/src/platform/message-history';

const page = (start: number, end: number, moderationVersion = 0): MessagePage => ({
  id: 'general',
  title: '#general',
  teamIds: [],
  blockedBy: [],
  latestSequence: end,
  moderationVersion,
  nextBefore: start > 1 ? start : null,
  messages: Array.from(
    { length: end - start + 1 },
    (_, index) =>
      ({
        id: `message-${start + index}`,
        sequence: start + index,
        createdAt: start + index,
        authorUid: 'person',
        authorName: 'Sam',
        authorRole: 'member',
        fromTeamId: null,
        body: 'Hello',
      }) satisfies GeneralMessage,
  ),
});

describe('message history refresh', () => {
  it('keeps a cursor to skipped messages after a burst exceeds the page size', () => {
    const refreshed = mergeMessagePages(page(1, 40), page(61, 100), false);
    expect(refreshed.messages).toHaveLength(40);
    expect(refreshed.nextBefore).toBe(61);
    const older = mergeMessagePages(refreshed, page(21, 60), true);
    expect(older.messages).toHaveLength(80);
    expect(older.nextBefore).toBe(21);
    expect((older.messages as GeneralMessage[]).map((message) => message.sequence)).toEqual(
      Array.from({ length: 80 }, (_, index) => index + 21),
    );
  });
  it('discards previously loaded text when an older message is moderated', () => {
    const refreshed = mergeMessagePages(page(1, 80), page(41, 80, 1), false);
    expect(refreshed.messages).toHaveLength(40);
    expect(refreshed.nextBefore).toBe(41);
    expect(refreshed.messages.some((message) => message.id === 'message-5')).toBe(false);
  });
  it('preserves contiguous older history during ordinary incoming messages', () => {
    const refreshed = mergeMessagePages(page(1, 80), page(45, 84), false);
    expect(refreshed.messages).toHaveLength(84);
    expect(refreshed.nextBefore).toBeNull();
  });
});

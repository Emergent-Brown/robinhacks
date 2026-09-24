import type { MessagePage } from '@robinhacks/core';

/** Keep loaded history only while the new page overlaps it and no messages were moderated. */
export function mergeMessagePages(
  previous: MessagePage | null,
  next: MessagePage,
  older: boolean,
): MessagePage {
  if (!previous) return next;
  if (previous.moderationVersion !== next.moderationVersion) return next;
  if (older)
    return {
      ...next,
      messages: [
        ...next.messages,
        ...previous.messages.filter(
          (message) => !next.messages.some((item) => item.id === message.id),
        ),
      ],
    };
  const overlaps = next.messages.some((message) =>
    previous.messages.some((item) => item.id === message.id),
  );
  // A burst larger than one page leaves a gap. Restart at the latest page so its cursor
  // can fetch every skipped message instead of presenting an apparently complete history.
  if (!overlaps) return next;
  const messages = new Map(previous.messages.map((message) => [message.id, message]));
  next.messages.forEach((message) => messages.set(message.id, message));
  return {
    ...next,
    messages: [...messages.values()].sort(
      (a, b) =>
        a.createdAt - b.createdAt ||
        ('sequence' in a && 'sequence' in b ? a.sequence - b.sequence : 0),
    ),
    nextBefore: previous.nextBefore,
  };
}

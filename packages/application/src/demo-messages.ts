import type {
  ConversationDirectoryEntry,
  GeneralMessage,
  Member,
  Team,
  TeamConversation,
} from '@robinhacks/core';
import type { DocumentMap } from './memory-repository';
import { MessagingService } from './services/messaging-service';

/** Fictional chat content belongs only to local demo/emulator documents. */
export function addDemoMessages(
  documents: DocumentMap,
  root: string,
  teams: Team[],
  now: number,
  includeTeamChat: boolean,
): void {
  const people = Object.entries(documents)
    .filter(([path]) => path.startsWith(`${root}/members/`))
    .map(([, value]) => value as Member);
  const organizer = people.find((member) => member.role === 'organizer')!;
  const attendee = people.find((member) => member.uid === 'demo-attendee')!;
  const sample: Array<{ author: Member; body: string }> = [
    {
      author: organizer,
      body: 'Welcome to Emergent Hacks. Use this channel for event questions, finding teammates, and asking for help.',
    },
    { author: attendee, body: 'Does anyone have a spare USB-C cable? I left mine at the dorm.' },
    {
      author: organizer,
      body: 'There are a few spare cables at the check-in table. Come find us.',
    },
  ];
  const messages: GeneralMessage[] = sample.map(({ author, body }, index) => ({
    id: `demo-general-${index + 1}`,
    sequence: index + 1,
    authorUid: author.uid,
    authorName: author.displayName,
    authorRole: author.role,
    fromTeamId: author.teamId,
    body,
    createdAt: now - (10 - index) * 60000,
  }));
  const latest = messages.at(-1)!;
  documents[`${root}/messageChannels/general`] = {
    latestSequence: latest.sequence,
    lastMessage: latest.body,
    updatedAt: latest.createdAt,
    lastAuthorUid: latest.authorUid,
    moderationVersion: 0,
  };
  documents[`${root}/messageChannels/general/pages/0`] = { messages };
  if (!includeTeamChat) return;
  const first = teams[0]!,
    second = teams[1]!;
  const firstCaptain = people.find((member) => member.uid === first.captainUid)!;
  const secondCaptain = people.find((member) => member.uid === second.captainUid)!;
  const id = MessagingService.conversationId(first.id, second.id);
  const conversation: TeamConversation = {
    id,
    teamIds: [first.id, second.id].sort(),
    blockedBy: [],
    readAt: { [second.id]: now - 240000 },
    version: 2,
    messages: [
      {
        id: 'demo-team-question',
        fromTeamId: first.id,
        authorUid: firstCaptain.uid,
        authorName: firstCaptain.displayName,
        authorRole: 'captain',
        body: 'Could we try your prototype before the next round? We have about ten minutes.',
        createdAt: now - 300000,
      },
      {
        id: 'demo-team-reply',
        fromTeamId: second.id,
        authorUid: secondCaptain.uid,
        authorName: secondCaptain.displayName,
        authorRole: 'captain',
        body: 'Yes, stop by our table. The main flow works; we are still fixing the error screen.',
        createdAt: now - 240000,
      },
    ],
  };
  documents[`${root}/conversations/${id}`] = conversation;
  const participants = people.filter(
    (member) => member.teamId === first.id || member.teamId === second.id,
  );
  documents[`${root}/conversationDirectory/${id}`] = {
    id,
    teamIds: conversation.teamIds,
    teamNames: [first.name, second.name],
    participantUids: participants.map((member) => member.uid),
    participantNames: Object.fromEntries(
      participants.map((member) => [member.uid, member.displayName]),
    ),
    lastMessage: conversation.messages.at(-1)!.body,
    updatedAt: now - 240000,
    messageCount: 2,
    blocked: false,
  } satisfies ConversationDirectoryEntry;
  for (const [team, other] of [
    [first, second],
    [second, first],
  ] as const) {
    documents[`${root}/teamInboxes/${team.id}`] = {
      teamId: team.id,
      lastSentAt: now - 240000,
      conversations: [
        {
          id,
          otherTeamId: other.id,
          lastMessage: conversation.messages.at(-1)!.body,
          updatedAt: now - 240000,
          unread: team.id === first.id,
          blocked: false,
        },
      ],
    };
  }
}

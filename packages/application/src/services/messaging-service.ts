import type {
  CommunityCommand,
  ConversationSummary,
  ConversationDirectoryEntry,
  MessagePage,
  Member,
  MessageReport,
  Team,
  TeamConversation,
  TeamMessage,
} from '@robinhacks/core';
import { sha256 } from '../../../core/src/sha256';
import { requireState } from '../errors';
import type { EventPaths } from '../paths';
import type { Transaction } from '../repository';
import { receipt, type CommandContext } from './context';
import { Permissions } from './permissions';
import { chatRecordId } from './chat-records';
import { PlatformPermissions as Guard } from './platform-permissions';

export interface TeamInbox {
  teamId: string;
  conversations: ConversationSummary[];
  lastSentAt: number | null;
}
type MessagingCommand = Extract<
  CommunityCommand,
  { type: 'sendMessage' | 'readConversation' | 'blockConversation' | 'reportMessage' }
>;

/** Team participants share an inbox; organizers can review threads through a separate read API. */
export class MessagingService {
  static conversationId(first: string, second: string): string {
    return sha256(JSON.stringify([first, second].sort()));
  }

  async readConversation(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
    otherTeamId: string,
  ): Promise<TeamConversation | null> {
    const teamId = Guard.team(member);
    requireState(teamId !== otherTeamId, 'OWN_TEAM', 'Choose another team.');
    const [conversation, ownTeam, otherTeam] = await Promise.all([
      tx.get<TeamConversation>(
        paths.doc('conversations', MessagingService.conversationId(teamId, otherTeamId)),
      ),
      tx.get<Team>(paths.team(teamId)),
      tx.get<Team>(paths.team(otherTeamId)),
    ]);
    requireState(ownTeam && otherTeam, 'NOT_FOUND', 'This team no longer exists.');
    if (conversation) this.assertParticipants(conversation, teamId, otherTeamId);
    return conversation;
  }

  async page(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
    otherTeamId: string,
    before?: number,
  ): Promise<MessagePage> {
    const conversation = await this.readConversation(tx, paths, member, otherTeamId);
    const other = await tx.get<Team>(paths.team(otherTeamId));
    requireState(other, 'NOT_FOUND', 'This team no longer exists.');
    return MessagingService.pageOf(conversation, other.name, before);
  }

  static pageOf(
    conversation: TeamConversation | null,
    title: string,
    before?: number,
  ): MessagePage {
    const messages = conversation?.messages ?? [];
    const end = Math.min(messages.length, before === undefined ? messages.length : before - 1);
    const start = Math.max(0, end - 40);
    return {
      id: conversation?.id ?? '',
      title,
      teamIds: conversation?.teamIds ?? [],
      messages: messages.slice(start, end),
      blockedBy: conversation?.blockedBy ?? [],
      nextBefore: start > 0 ? start + 1 : null,
      latestSequence: messages.length,
      moderationVersion: conversation?.moderationVersion ?? 0,
    };
  }

  async inbox(tx: Transaction, paths: EventPaths, member: Member): Promise<ConversationSummary[]> {
    if (
      !member.teamId ||
      member.status !== 'approved' ||
      ['organizer', 'judge'].includes(member.role)
    )
      return [];
    const inbox = await tx.get<TeamInbox>(paths.doc('teamInboxes', member.teamId));
    requireState(
      !inbox || inbox.teamId === member.teamId,
      'CONVERSATION_FORBIDDEN',
      'This inbox belongs to another team.',
    );
    return [...(inbox?.conversations ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async execute(context: CommandContext, command: MessagingCommand) {
    const { tx, paths, event, member, now } = context;
    Guard.config(event);
    const teamId = Guard.team(member);
    const otherTeamId = command.type === 'sendMessage' ? command.toTeamId : command.otherTeamId;
    requireState(teamId !== otherTeamId, 'OWN_TEAM', 'Choose another team.');
    const id = MessagingService.conversationId(teamId, otherTeamId);
    const [stored, ownInbox, otherInbox, ownTeam, otherTeam] = await Promise.all([
      tx.get<TeamConversation>(paths.doc('conversations', id)),
      tx.get<TeamInbox>(paths.doc('teamInboxes', teamId)),
      tx.get<TeamInbox>(paths.doc('teamInboxes', otherTeamId)),
      tx.get<Team>(paths.team(teamId)),
      tx.get<Team>(paths.team(otherTeamId)),
    ]);
    requireState(ownTeam && otherTeam, 'NOT_FOUND', 'This team does not exist.');
    const conversation: TeamConversation = stored ?? {
      id,
      teamIds: [teamId, otherTeamId].sort(),
      messages: [],
      blockedBy: [],
      readAt: {},
      version: 0,
    };
    this.assertParticipants(conversation, teamId, otherTeamId);
    requireState(
      !ownInbox || ownInbox.teamId === teamId,
      'CONVERSATION_FORBIDDEN',
      'This inbox belongs to another team.',
    );
    requireState(
      !otherInbox || otherInbox.teamId === otherTeamId,
      'CONVERSATION_FORBIDDEN',
      'This inbox belongs to another team.',
    );

    if (command.type === 'reportMessage') {
      const message = conversation.messages.find((candidate) => candidate.id === command.messageId);
      requireState(
        message && message.fromTeamId !== teamId,
        'MESSAGE_NOT_FOUND',
        'Choose a message from the other team.',
      );
      requireState(
        command.reason.trim().length >= 3 && command.reason.length <= 500,
        'REPORT_REASON_REQUIRED',
        'Give a short reason for the report.',
      );
      const [reports, previousId] = await Promise.all([
        tx.list<MessageReport>(paths.collection('messageReports'), 101),
        tx.get<MessageReport>(paths.doc('messageReports', command.commandId)),
      ]);
      requireState(
        !previousId,
        'COMMAND_CONFLICT',
        'This report identifier already exists. Start a new report.',
      );
      requireState(
        reports.length < 100,
        'REPORT_LIMIT',
        'Contact the event organizer to report this message.',
      );
      requireState(
        !reports.some(
          (report) =>
            report.conversationId === id &&
            report.messageId === message.id &&
            report.reporterUid === member.uid,
        ),
        'ALREADY_REPORTED',
        'You already reported this message.',
      );
      const report: MessageReport = {
        id: command.commandId,
        conversationId: id,
        messageId: message.id,
        reporterUid: member.uid,
        reason: command.reason.trim(),
        body: message.body,
        createdAt: now,
      };
      tx.set(paths.doc('messageReports', report.id), report);
      return { receipt: receipt(context, command, 'Message reported to the organizers.') };
    }

    if (command.type === 'readConversation') {
      if (!stored) return { message: 'No messages yet.' };
      conversation.readAt = { ...conversation.readAt, [teamId]: now };
    } else if (command.type === 'blockConversation') {
      conversation.blockedBy = command.blocked
        ? [...new Set([...conversation.blockedBy, teamId])]
        : conversation.blockedBy.filter((blocked) => blocked !== teamId);
    } else {
      Permissions.editable(event);
      requireState(
        !conversation.messages.some(
          (message) => message.id === chatRecordId(member.uid, command.commandId),
        ),
        'COMMAND_CONFLICT',
        'This message identifier already exists. Start a new message.',
      );
      requireState(
        ownTeam.eligibility === 'active' && otherTeam.eligibility === 'active',
        'TEAM_INACTIVE',
        'Messages can be sent only between active teams.',
      );
      requireState(
        conversation.blockedBy.length === 0,
        'CONVERSATION_BLOCKED',
        'Messaging is blocked for this conversation.',
      );
      requireState(
        command.body.trim().length > 0 && command.body.length <= 1000,
        'INVALID_MESSAGE',
        'Messages must contain 1–1,000 characters.',
      );
      requireState(
        ownInbox?.lastSentAt == null || now - ownInbox.lastSentAt >= 5000,
        'RATE_LIMITED',
        'Your team can send one message every five seconds.',
      );
      requireState(
        conversation.messages.length < 250,
        'CONVERSATION_FULL',
        'This conversation has reached its 250-message limit.',
      );
      const message: TeamMessage = {
        id: chatRecordId(member.uid, command.commandId),
        fromTeamId: teamId,
        authorName: member.displayName,
        authorUid: member.uid,
        authorRole: member.role,
        body: command.body.trim(),
        createdAt: now,
      };
      conversation.messages = [...conversation.messages, message];
      conversation.readAt = { ...conversation.readAt, [teamId]: now };
    }
    if (command.type !== 'readConversation') {
      const [directory, firstRoster, secondRoster] = await Promise.all([
        tx.get<ConversationDirectoryEntry>(paths.doc('conversationDirectory', id)),
        tx.list<Member>(`${paths.team(teamId)}/members`, 151),
        tx.list<Member>(`${paths.team(otherTeamId)}/members`, 151),
      ]);
      const last = conversation.messages.at(-1);
      tx.set(paths.doc('conversationDirectory', id), {
        id,
        teamIds: conversation.teamIds,
        teamNames: conversation.teamIds.map((id) =>
          id === ownTeam.id ? ownTeam.name : otherTeam.name,
        ),
        participantUids: [
          ...new Set([
            ...(directory?.participantUids ?? []),
            member.uid,
            ...[...firstRoster, ...secondRoster]
              .filter((person) => person.status === 'approved')
              .map((person) => person.uid),
            ...conversation.messages.flatMap((message) =>
              message.authorUid ? [message.authorUid] : [],
            ),
          ]),
        ],
        participantNames: {
          ...(directory?.participantNames ?? {}),
          ...Object.fromEntries(
            [...firstRoster, ...secondRoster].map((person) => [person.uid, person.displayName]),
          ),
          ...Object.fromEntries(
            conversation.messages.flatMap((message) =>
              message.authorUid ? [[message.authorUid, message.authorName]] : [],
            ),
          ),
          [member.uid]: member.displayName,
        },
        lastMessage: last?.body.slice(0, 160) ?? '',
        updatedAt: last?.createdAt ?? now,
        messageCount: conversation.messages.length,
        blocked: conversation.blockedBy.length > 0,
      } satisfies ConversationDirectoryEntry);
    }
    conversation.version += 1;
    tx.set(paths.doc('conversations', id), conversation);
    const own = this.updateInbox(ownInbox, conversation, teamId);
    if (command.type === 'sendMessage') own.lastSentAt = now;
    tx.set(paths.doc('teamInboxes', teamId), own);
    // Marking our own view as read does not change the recipient's inbox.
    if (command.type !== 'readConversation')
      tx.set(
        paths.doc('teamInboxes', otherTeamId),
        this.updateInbox(otherInbox, conversation, otherTeamId),
      );
    return {
      receipt: receipt(
        context,
        command,
        command.type === 'sendMessage'
          ? 'Message sent.'
          : command.type === 'readConversation'
            ? 'Conversation read.'
            : command.blocked
              ? 'Conversation blocked.'
              : 'Conversation unblocked.',
      ),
    };
  }

  private assertParticipants(
    conversation: TeamConversation,
    teamId: string,
    otherTeamId: string,
  ): void {
    requireState(
      conversation.teamIds.length === 2 &&
        conversation.teamIds.includes(teamId) &&
        conversation.teamIds.includes(otherTeamId),
      'CONVERSATION_FORBIDDEN',
      'This conversation belongs to other teams.',
    );
  }

  private updateInbox(
    prior: TeamInbox | null,
    conversation: TeamConversation,
    teamId: string,
  ): TeamInbox {
    const last = conversation.messages.at(-1);
    const summary: ConversationSummary = {
      id: conversation.id,
      otherTeamId: conversation.teamIds.find((id) => id !== teamId)!,
      lastMessage: last?.body.slice(0, 160) ?? '',
      updatedAt: last?.createdAt ?? 0,
      unread:
        !!last &&
        last.fromTeamId !== teamId &&
        last.createdAt > (conversation.readAt[teamId] ?? -1),
      blocked: conversation.blockedBy.length > 0,
    };
    return {
      teamId,
      lastSentAt: prior?.lastSentAt ?? null,
      conversations: [
        ...(prior?.conversations ?? []).filter((item) => item.id !== conversation.id),
        summary,
      ],
    };
  }
}

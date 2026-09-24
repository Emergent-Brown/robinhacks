import type {
  CommunityCommand,
  GeneralChannelSummary,
  GeneralMessage,
  Member,
  MessagePage,
} from '@robinhacks/core';
import { requireState } from '../errors';
import type { EventPaths } from '../paths';
import type { Transaction } from '../repository';
import { receipt, type CommandContext } from './context';
import { Permissions } from './permissions';
import { chatRecordId } from './chat-records';

export const CHAT_PAGE_SIZE = 40;
interface ChannelState {
  moderationVersion?: number;
  latestSequence: number;
  lastMessage: string;
  updatedAt: number;
  lastAuthorUid?: string;
}
interface ReadState {
  throughSequence: number;
  lastSentAt: number | null;
}
export interface GeneralMessageChunk {
  messages: GeneralMessage[];
}
type GeneralCommand = Extract<CommunityCommand, { type: 'sendGeneralMessage' | 'readGeneral' }>;

/** A shared channel with append-only, 40-message storage pages and per-person read cursors. */
export class GeneralChatService {
  static chunkPath(paths: EventPaths, sequence: number): string {
    return `${paths.doc('messageChannels', 'general')}/pages/${Math.floor((sequence - 1) / CHAT_PAGE_SIZE)}`;
  }

  async summary(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
  ): Promise<GeneralChannelSummary> {
    Permissions.member(member);
    const [state, read] = await Promise.all([
      tx.get<ChannelState>(paths.doc('messageChannels', 'general')),
      tx.get<ReadState>(paths.doc('generalReadStates', member.uid)),
    ]);
    return {
      moderationVersion: state?.moderationVersion ?? 0,
      latestSequence: state?.latestSequence ?? 0,
      lastMessage: state?.lastMessage ?? '',
      updatedAt: state?.updatedAt ?? 0,
      unread: (state?.latestSequence ?? 0) > (read?.throughSequence ?? 0),
    };
  }

  async page(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
    before?: number,
  ): Promise<MessagePage> {
    Permissions.member(member);
    const state = await tx.get<ChannelState>(paths.doc('messageChannels', 'general'));
    const latest = state?.latestSequence ?? 0;
    const end = Math.min(latest, before === undefined ? latest : before - 1);
    const start = Math.max(1, end - CHAT_PAGE_SIZE + 1);
    const pagePaths =
      end > 0
        ? [
            ...new Set([
              GeneralChatService.chunkPath(paths, start),
              GeneralChatService.chunkPath(paths, end),
            ]),
          ]
        : [];
    const pages = await Promise.all(pagePaths.map((path) => tx.get<GeneralMessageChunk>(path)));
    return {
      id: 'general',
      title: '#general',
      teamIds: [],
      blockedBy: [],
      messages: pages
        .flatMap((page) => page?.messages ?? [])
        .filter((message) => message.sequence >= start && message.sequence <= end)
        .sort((a, b) => a.sequence - b.sequence),
      nextBefore: start > 1 ? start : null,
      latestSequence: latest,
      moderationVersion: state?.moderationVersion ?? 0,
    };
  }

  async execute(context: CommandContext, command: GeneralCommand) {
    const { tx, paths, member, event, now } = context;
    Permissions.member(member);
    const [state, read] = await Promise.all([
      tx.get<ChannelState>(paths.doc('messageChannels', 'general')),
      tx.get<ReadState>(paths.doc('generalReadStates', member.uid)),
    ]);
    const latest = state?.latestSequence ?? 0;
    if (command.type === 'readGeneral') {
      requireState(
        Number.isSafeInteger(command.throughSequence) &&
          command.throughSequence >= 0 &&
          command.throughSequence <= latest,
        'INVALID_CURSOR',
        'Refresh the channel before marking these messages read.',
      );
      tx.set(paths.doc('generalReadStates', member.uid), {
        throughSequence: Math.max(read?.throughSequence ?? 0, command.throughSequence),
        lastSentAt: read?.lastSentAt ?? null,
      } satisfies ReadState);
      return { message: 'Channel read.' };
    }
    // Organizers can still post practical wrap-up information after results are published.
    if (member.role !== 'organizer') Permissions.editable(event);
    requireState(
      command.body.trim().length > 0 && command.body.length <= 1000,
      'INVALID_MESSAGE',
      'Messages must contain 1–1,000 characters.',
    );
    requireState(
      read?.lastSentAt == null || now - read.lastSentAt >= 5000,
      'RATE_LIMITED',
      'Wait five seconds before sending another message.',
    );
    requireState(latest < 100000, 'CHANNEL_FULL', 'This event chat has reached its message limit.');
    const sequence = latest + 1;
    const chunkPath = GeneralChatService.chunkPath(paths, sequence);
    const chunk = await tx.get<GeneralMessageChunk>(chunkPath);
    const message: GeneralMessage = {
      id: chatRecordId(member.uid, command.commandId),
      sequence,
      fromTeamId: member.teamId,
      authorUid: member.uid,
      authorName: member.displayName,
      authorRole: member.role,
      body: command.body.trim(),
      createdAt: now,
    };
    tx.set(chunkPath, { messages: [...(chunk?.messages ?? []), message] });
    tx.set(paths.doc('messageChannels', 'general'), {
      moderationVersion: state?.moderationVersion ?? 0,
      latestSequence: sequence,
      lastMessage: message.body.slice(0, 160),
      updatedAt: now,
      lastAuthorUid: member.uid,
    } satisfies ChannelState);
    tx.set(paths.doc('generalReadStates', member.uid), {
      throughSequence: sequence,
      lastSentAt: now,
    } satisfies ReadState);
    return { receipt: receipt(context, command, 'Posted to #general.') };
  }
}

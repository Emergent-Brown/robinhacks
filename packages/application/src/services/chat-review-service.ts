import type {
  CommunityCommand,
  ConversationDirectoryEntry,
  GeneralMessage,
  Member,
  MessagePage,
  TeamConversation,
  TeamMessage,
} from '@robinhacks/core';
import { requireState } from '../errors';
import type { EventPaths } from '../paths';
import type { Transaction } from '../repository';
import { receipt, type CommandContext } from './context';
import { GeneralChatService, type GeneralMessageChunk } from './general-chat-service';
import { MessagingService, type TeamInbox } from './messaging-service';
import { Permissions } from './permissions';
import { chatRecordId } from './chat-records';

type RemovalCommand = Extract<CommunityCommand, { type: 'removeChatMessage' }>;
/** Organizer review is read-only. Moderation is a separate, explicitly audited action. */
export class ChatReviewService {
  async directory(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
  ): Promise<ConversationDirectoryEntry[]> {
    Permissions.member(member);
    Permissions.organizer(member);
    return (
      await tx.list<ConversationDirectoryEntry>(paths.collection('conversationDirectory'), 1000)
    ).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  async page(
    tx: Transaction,
    paths: EventPaths,
    member: Member,
    id: string,
    before?: number,
  ): Promise<MessagePage> {
    Permissions.member(member);
    Permissions.organizer(member);
    const [conversation, summary] = await Promise.all([
      tx.get<TeamConversation>(paths.doc('conversations', id)),
      tx.get<ConversationDirectoryEntry>(paths.doc('conversationDirectory', id)),
    ]);
    requireState(conversation, 'NOT_FOUND', 'This conversation no longer exists.');
    return MessagingService.pageOf(
      conversation,
      summary?.teamNames.join(' ↔ ') || 'Team conversation',
      before,
    );
  }

  async remove(context: CommandContext, command: RemovalCommand) {
    const { tx, paths, member, now } = context;
    Permissions.member(member);
    Permissions.organizer(member);
    requireState(
      command.reason.trim().length >= 5 && command.reason.length <= 500,
      'REASON_REQUIRED',
      'Give a short reason for removing this message.',
    );
    const tombstone = <T extends TeamMessage | GeneralMessage>(message: T): T => ({
      ...message,
      body: 'Message removed by an organizer.',
      removedAt: now,
      removedBy: member.uid,
      removalReason: command.reason.trim(),
    });
    let original: TeamMessage | GeneralMessage;
    if (command.kind === 'general') {
      requireState(
        command.id === 'general' && Number.isSafeInteger(command.sequence) && command.sequence! > 0,
        'INVALID_CURSOR',
        'Select a message from #general.',
      );
      const chunkPath = GeneralChatService.chunkPath(paths, command.sequence!);
      const [chunk, state] = await Promise.all([
        tx.get<GeneralMessageChunk>(chunkPath),
        tx.get<{
          latestSequence: number;
          lastMessage: string;
          updatedAt: number;
          moderationVersion?: number;
        }>(paths.doc('messageChannels', 'general')),
      ]);
      const message = chunk?.messages.find(
        (item) => item.id === command.messageId && item.sequence === command.sequence,
      );
      requireState(
        message && state && chunk,
        'MESSAGE_NOT_FOUND',
        'This message no longer exists.',
      );
      requireState(!message.removedAt, 'ALREADY_REMOVED', 'This message has already been removed.');
      original = message;
      tx.set(chunkPath, {
        messages: chunk.messages.map((item) => (item.id === message.id ? tombstone(item) : item)),
      });
      tx.set(paths.doc('messageChannels', 'general'), {
        ...state,
        updatedAt: now,
        moderationVersion: (state.moderationVersion ?? 0) + 1,
        lastMessage:
          state.latestSequence === message.sequence
            ? 'Message removed by an organizer.'
            : state.lastMessage,
      });
    } else {
      const [conversation, directory] = await Promise.all([
        tx.get<TeamConversation>(paths.doc('conversations', command.id)),
        tx.get<ConversationDirectoryEntry>(paths.doc('conversationDirectory', command.id)),
      ]);
      const message = conversation?.messages.find((item) => item.id === command.messageId);
      requireState(conversation && message, 'MESSAGE_NOT_FOUND', 'This message no longer exists.');
      requireState(!message.removedAt, 'ALREADY_REMOVED', 'This message has already been removed.');
      const inboxes = await Promise.all(
        conversation.teamIds.map((id) => tx.get<TeamInbox>(paths.doc('teamInboxes', id))),
      );
      original = message;
      const updated = {
        ...conversation,
        moderationVersion: (conversation.moderationVersion ?? 0) + 1,
        version: conversation.version + 1,
        messages: conversation.messages.map((item) =>
          item.id === message.id ? tombstone(item) : item,
        ),
      };
      tx.set(paths.doc('conversations', command.id), updated);
      const preview = updated.messages.at(-1)?.body.slice(0, 160) ?? '';
      if (directory)
        tx.set(paths.doc('conversationDirectory', command.id), {
          ...directory,
          lastMessage: preview,
          updatedAt: now,
        });
      inboxes.forEach((inbox, index) => {
        if (inbox)
          tx.set(paths.doc('teamInboxes', conversation.teamIds[index]!), {
            ...inbox,
            conversations: inbox.conversations.map((item) =>
              item.id === command.id ? { ...item, lastMessage: preview, updatedAt: now } : item,
            ),
          });
      });
    }
    tx.set(paths.doc('moderatedMessages', chatRecordId(member.uid, command.commandId)), {
      id: chatRecordId(member.uid, command.commandId),
      kind: command.kind,
      conversationId: command.id,
      original,
      removedBy: member.uid,
      removedAt: now,
      reason: command.reason.trim(),
    });
    return {
      receipt: receipt(
        context,
        command,
        'Message removed. The original is retained in the moderation record.',
      ),
    };
  }
}

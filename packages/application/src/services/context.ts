import type { Command, EventConfig, Member, Receipt } from '@robinhacks/core';
import type { Clock, Transaction } from '../repository';
import type { EventPaths } from '../paths';
export interface CommandContext {
  tx: Transaction;
  paths: EventPaths;
  event: EventConfig;
  member: Member;
  actor: { uid: string; displayName?: string };
  now: number;
  clock: Clock;
  payloadKey: string;
}
export function receipt(
  context: CommandContext,
  command: Command,
  detail: string,
  changes: Partial<Receipt> = {},
): Receipt {
  return {
    id: command.commandId,
    kind: command.type,
    teamId: context.member.teamId ?? '',
    actorUid: context.actor.uid,
    acceptedAt: context.now,
    detail,
    entries: [],
    payloadKey: context.payloadKey,
    rulesVersion: context.event.rulesVersion,
    phaseVersion: context.event.phaseVersion,
    ...changes,
  };
}

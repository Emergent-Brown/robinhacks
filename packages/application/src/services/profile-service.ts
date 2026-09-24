import type { Command, CommandResult, Member } from '@robinhacks/core';
import type { CommandContext } from './context';
import { Permissions } from './permissions';

/** A participant owns their optional biography; membership and event roles stay separate. */
export class ProfileService {
  update(
    { tx, paths, member, actor }: CommandContext,
    command: Extract<Command, { type: 'updateProfile' }>,
  ): CommandResult {
    Permissions.member(member);
    const { bio: _previousBio, ...identity } = member;
    const bio = command.bio.trim();
    const updated: Member = {
      ...identity,
      ...(bio ? { bio } : {}),
      version: member.version + 1,
    };
    // Ownership comes only from the authenticated actor, never a requested target UID.
    tx.set(paths.member(actor.uid), updated);
    if (member.teamId) tx.set(`${paths.team(member.teamId)}/members/${actor.uid}`, updated);
    return { message: bio ? 'Bio saved.' : 'Bio removed.' };
  }
}

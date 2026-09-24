import type {
  AccessRequest,
  Command,
  EventConfig,
  Member,
  OrganizerInvite,
  Team,
} from '@robinhacks/core';
import { requireState } from '../errors';
import type { EventPaths } from '../paths';
import type { Transaction } from '../repository';
import type { CommandContext } from './context';
import { Permissions } from './permissions';

export const normalizeOrganizerEmail = (email: string) => email.trim().toLowerCase();
export const organizerInvitePath = (paths: EventPaths, email: string) =>
  `${paths.collection('organizerInvites')}/${encodeURIComponent(normalizeOrganizerEmail(email))}`;

/** Verified account emails claim explicit organizer invitations; signup never chooses this role. */
export class OrganizerAccessService {
  async execute(
    context: CommandContext,
    command: Extract<
      Command,
      { type: 'addOrganizerEmail' | 'removeOrganizerEmail' | 'removeMember' }
    >,
  ) {
    const { tx, paths, event, member, now } = context;
    Permissions.organizer(member);
    requireState(
      ['DRAFT', 'REGISTRATION'].includes(event.phase) || event.paused,
      'ROSTER_LOCKED',
      'Pause the event before changing access after registration.',
    );
    const members = await tx.list<Member>(paths.collection('members'), 501);
    requireState(
      members.length <= 500,
      'MEMBER_LIMIT',
      'The event has too many membership records.',
    );
    if (command.type === 'addOrganizerEmail') {
      const email = normalizeOrganizerEmail(command.email);
      const matching = members.filter(
        (entry) => entry.email && normalizeOrganizerEmail(entry.email) === email,
      );
      requireState(
        matching.every((entry) => entry.teamId === null),
        'STAFF_CANNOT_COMPETE',
        'Remove this account’s competing membership before inviting it as an organizer.',
      );
      requireState(
        matching.every((entry) => entry.status !== 'suspended'),
        'MEMBERSHIP_SUSPENDED',
        'Remove the suspended membership before inviting this account again.',
      );
      const path = organizerInvitePath(paths, email);
      const [prior, invites] = await Promise.all([
        tx.get<OrganizerInvite>(path),
        tx.list<OrganizerInvite>(paths.collection('organizerInvites'), 501),
      ]);
      requireState(
        prior || invites.length < 500,
        'INVITE_LIMIT',
        'This event has too many organizer invitations.',
      );
      if (!prior) tx.set(path, { email, createdAt: now } satisfies OrganizerInvite);
      tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
      return {
        message: `Organizer access invited for ${email}. They can sign in with Google to claim it.`,
      };
    }
    if (command.type === 'removeOrganizerEmail') {
      const email = normalizeOrganizerEmail(command.email);
      const matching = members.filter(
        (entry) =>
          entry.role === 'organizer' &&
          entry.email &&
          normalizeOrganizerEmail(entry.email) === email,
      );
      this.assertRemoval(member, matching, members);
      for (const target of matching)
        await this.removeIdentity(tx, paths, target, now, member.uid, command.commandId);
      tx.delete(organizerInvitePath(paths, email));
      tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
      return { message: `Organizer access removed for ${email}.` };
    }
    const target = members.find((entry) => entry.uid === command.uid);
    const request = await tx.get<AccessRequest>(paths.doc('accessRequests', command.uid));
    requireState(
      target || request,
      'NOT_FOUND',
      'This account has no event access or pending request.',
    );
    requireState(
      command.uid !== member.uid,
      'SELF_REMOVAL',
      'Another organizer must remove your access.',
    );
    if (target) {
      this.assertRemoval(member, [target], members);
      await this.removeIdentity(tx, paths, target, now, member.uid, command.commandId);
    } else {
      tx.delete(paths.doc('accessRequests', command.uid));
      if (request?.email) tx.delete(organizerInvitePath(paths, request.email));
    }
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return { message: 'Event access removed. Project and submitted records were preserved.' };
  }

  async claim(
    tx: Transaction,
    paths: EventPaths,
    event: EventConfig,
    current: Member | null,
    actor: CommandContext['actor'],
    now: number,
  ): Promise<Member | null> {
    if (!actor.email || actor.emailVerified !== true || current?.status === 'suspended')
      return current;
    const email = normalizeOrganizerEmail(actor.email);
    const invitation = await tx.get<OrganizerInvite>(organizerInvitePath(paths, email));
    if (!invitation || invitation.email !== email) return current;
    requireState(
      !current?.teamId,
      'STAFF_CANNOT_COMPETE',
      'An organizer invitation cannot change a competing team account. Contact an organizer.',
    );
    if (current?.role === 'organizer' && current.status === 'approved') return current;
    const members = await tx.list<Member>(paths.collection('members'), 501);
    requireState(
      current || members.length < 500,
      'MEMBER_LIMIT',
      'This event has too many membership records.',
    );
    const approved: Member = {
      ...current,
      uid: actor.uid,
      displayName: current?.displayName || actor.displayName || email,
      email,
      emailVerified: true,
      teamId: null,
      role: 'organizer',
      status: 'approved',
      version: (current?.version ?? 0) + 1,
    };
    const request = await tx.get<AccessRequest>(paths.doc('accessRequests', actor.uid));
    tx.set(paths.member(actor.uid), approved);
    if (request) tx.set(paths.doc('accessRequests', actor.uid), { ...request, status: 'approved' });
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    tx.set(`${paths.collection('adminAudit')}/organizer_claim_${actor.uid}`, {
      id: `organizer_claim_${actor.uid}`,
      actorUid: actor.uid,
      action: 'claimOrganizerInvite',
      detail: 'Verified account claimed its organizer invitation.',
      createdAt: now,
    });
    return approved;
  }

  private assertRemoval(actor: Member, removed: Member[], members: Member[]) {
    requireState(
      !removed.some((entry) => entry.uid === actor.uid),
      'SELF_REMOVAL',
      'Another organizer must remove your access.',
    );
    if (removed.some((entry) => entry.role === 'organizer' && entry.status === 'approved'))
      requireState(
        members.some(
          (entry) =>
            entry.role === 'organizer' &&
            entry.status === 'approved' &&
            !removed.some((target) => target.uid === entry.uid),
        ),
        'LAST_ORGANIZER',
        'Keep at least one approved organizer.',
      );
  }

  private async removeIdentity(
    tx: Transaction,
    paths: EventPaths,
    target: Member,
    now: number,
    actorUid: string,
    commandId: string,
  ) {
    // A later staff removal must not replace this account's former competing identity.
    // The operation key makes retries deterministic while preserving every removal.
    const removalId = encodeURIComponent(JSON.stringify([target.uid, actorUid, commandId]));
    tx.set(`${paths.collection('removedMembers')}/${removalId}`, { ...target, removedAt: now });
    if (target.teamId) {
      const team = await tx.get<Team>(paths.team(target.teamId));
      if (team?.captainUid === target.uid)
        tx.set(paths.team(team.id), { ...team, captainUid: '', version: team.version + 1 });
      tx.delete(`${paths.team(target.teamId)}/members/${target.uid}`);
    }
    tx.delete(paths.member(target.uid));
    tx.delete(paths.doc('accessRequests', target.uid));
    if (target.email) tx.delete(organizerInvitePath(paths, target.email));
  }
}

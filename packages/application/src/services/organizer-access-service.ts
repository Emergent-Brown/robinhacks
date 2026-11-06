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
      { type: 'addOrganizerEmail' | 'addOrganizerEmails' | 'removeOrganizerEmail' | 'removeMember' }
    >,
  ) {
    const { tx, paths, event, member, now } = context;
    Permissions.organizer(member);
    if (command.type === 'addOrganizerEmail' || command.type === 'addOrganizerEmails')
      return this.grant(context, command);
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

  /** One atomic batch: promote verified members now; absent accounts claim by verified email. */
  private async grant(
    { tx, paths, event, member, now }: CommandContext,
    command: Extract<Command, { type: 'addOrganizerEmail' | 'addOrganizerEmails' }>,
  ) {
    const emails = [
      ...new Set(
        (command.type === 'addOrganizerEmail' ? [command.email] : command.emails).map(
          normalizeOrganizerEmail,
        ),
      ),
    ];
    const [members, invites] = await Promise.all([
      tx.list<Member>(paths.collection('members'), 501),
      tx.list<OrganizerInvite>(paths.collection('organizerInvites'), 501),
    ]);
    requireState(
      members.length <= 500,
      'MEMBER_LIMIT',
      'The event has too many membership records.',
    );
    const existing = new Map(invites.map((invite) => [invite.email, invite]));
    requireState(
      invites.length + emails.filter((email) => !existing.has(email)).length <= 500,
      'INVITE_LIMIT',
      'This event supports at most 500 organizer invitations.',
    );
    const matching = members.filter(
      (entry) =>
        entry.emailVerified && entry.email && emails.includes(normalizeOrganizerEmail(entry.email)),
    );
    // Judges are part of the frozen results evidence too. Changing their role after
    // publication would make the exported score sheets lose their active judge identity.
    if (matching.some((entry) => entry.teamId || entry.role === 'judge'))
      Permissions.rosterEditable(event);
    let promoted = 0;
    for (const target of matching) {
      if (target.role !== 'organizer' || target.status !== 'approved' || target.teamId) {
        if (target.teamId)
          await this.removeIdentity(tx, paths, target, now, member.uid, command.commandId);
        tx.set(paths.member(target.uid), {
          ...target,
          role: 'organizer',
          status: 'approved',
          teamId: null,
          version: target.version + 1,
        } satisfies Member);
        promoted++;
      }
      // Staff should not remain in the participant approval queue.
      tx.delete(paths.doc('accessRequests', target.uid));
    }
    for (const email of emails)
      tx.set(organizerInvitePath(paths, email), existing.get(email) ?? { email, createdAt: now });
    tx.set(paths.root, {
      ...event,
      phaseVersion: event.phaseVersion + 1,
      rosterVersion: (event.rosterVersion ?? 0) + (promoted ? 1 : 0),
    });
    return {
      message: `Organizer access added for ${emails.length} ${emails.length === 1 ? 'email' : 'emails'}. ${promoted ? `${promoted} existing ${promoted === 1 ? 'member moved' : 'members moved'} to organizers. ` : ''}New organizers can sign in with Google.`,
    };
  }

  /** True when `claim` has something to do, so snapshots stay read-only otherwise. */
  async claimPending(
    tx: Transaction,
    paths: EventPaths,
    current: Member | null,
    actor: CommandContext['actor'],
  ): Promise<boolean> {
    if (!actor.email || actor.emailVerified !== true || current?.status === 'suspended')
      return false;
    const email = normalizeOrganizerEmail(actor.email);
    const invitation = await tx.get<OrganizerInvite>(organizerInvitePath(paths, email));
    if (!invitation || invitation.email !== email) return false;
    return !!current?.teamId || current?.role !== 'organizer' || current.status !== 'approved';
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
    // A verified-email claim must observe the same frozen-judge boundary as a direct grant.
    if (current?.role === 'judge') Permissions.rosterEditable(event);
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
    if (request) tx.delete(paths.doc('accessRequests', actor.uid));
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

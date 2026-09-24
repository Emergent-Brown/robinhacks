import { RULES } from '@robinhacks/core';
import type { Command, FormationRole, FormationTeam, Member, Team } from '@robinhacks/core';
import { requireState } from '../errors';
import type { Transaction } from '../repository';
import type { EventPaths } from '../paths';
import type { CommandContext } from './context';
import { Permissions } from './permissions';

type FormationCommand = Extract<
  Command,
  { type: 'setTeamFormation' | 'createFormationTeam' | 'joinFormationTeam' }
>;
const roles: FormationRole[] = ['captain', 'trader', 'member'];
const normalizedName = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** One transaction owns the participant's team choice and its exclusive role slots. */
export class TeamFormationService {
  async execute(context: CommandContext, command: FormationCommand) {
    const { tx, paths, event, member, now } = context;
    Permissions.member(member);
    requireState(event.platform, 'PLATFORM_REQUIRED', 'This event needs funding-round settings.');
    requireState(
      event.phase === 'REGISTRATION' &&
        event.platform.rulesLockedAt === null &&
        !event.paused &&
        !event.activeOperationId,
      'FORMATION_UNAVAILABLE',
      'Team formation is available during unpaused registration, before funding starts.',
    );
    if (command.type === 'setTeamFormation') {
      Permissions.organizer(member);
      requireState(
        event.phaseVersion === command.expectedPhaseVersion,
        'PHASE_CHANGED',
        'The event changed. Refresh before continuing.',
      );
      tx.set(paths.root, {
        ...event,
        phaseVersion: event.phaseVersion + 1,
        platform: { ...event.platform, teamFormationOpen: command.open },
      });
      return { message: command.open ? 'Team formation opened.' : 'Team formation closed.' };
    }
    requireState(
      event.platform.teamFormationOpen === true,
      'FORMATION_CLOSED',
      'The organizers have not opened team formation.',
    );
    requireState(
      member.teamId === null && member.role === 'member',
      'TEAM_ALREADY_ASSIGNED',
      'Only approved participants without a team can choose one.',
    );
    const [teams, members] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), RULES.maxTeams + 1),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    requireState(
      members.length <= 500,
      'MEMBER_LIMIT',
      'The event has too many membership records.',
    );
    let team: Team;
    if (command.type === 'createFormationTeam') {
      requireState(
        teams.length < RULES.maxTeams,
        'TEAM_LIMIT',
        'This event is limited to 30 teams.',
      );
      requireState(
        !teams.some((entry) => normalizedName(entry.name) === normalizedName(command.name)),
        'TEAM_EXISTS',
        'A team with that name already exists. Join it instead.',
      );
      const id = `team_${command.commandId.slice(0, 100)}`;
      requireState(
        !teams.some((entry) => entry.id === id),
        'TEAM_EXISTS',
        'That team identifier already exists. Try again with a new request.',
      );
      team = {
        id,
        name: command.name.trim(),
        ticker: `TEAM${teams.length + 1}`,
        pitch: '',
        category: '',
        color: ['#5b55e7', '#167d8d', '#d8713e', '#bf5898', '#3c8c67'][teams.length % 5]!,
        problem: '',
        building: '',
        demoUrl: '',
        repoUrl: '',
        update: '',
        updatedAt: now,
        eligibility: 'active',
        captainUid: command.role === 'captain' ? member.uid : '',
        version: 1,
      };
    } else {
      const selected = teams.find((entry) => entry.id === command.teamId);
      requireState(selected?.eligibility === 'active', 'TEAM_INACTIVE', 'Choose an active team.');
      requireState(
        this.availableRoles(members, selected.id).includes(command.role),
        'ROLE_LIMIT',
        'That role was just taken. Choose another available role.',
      );
      team = {
        ...selected,
        captainUid: command.role === 'captain' ? member.uid : selected.captainUid,
        version: selected.version + 1,
        updatedAt: now,
      };
    }
    const joined: Member = {
      ...member,
      role: command.role,
      teamId: team.id,
      version: member.version + 1,
    };
    tx.set(paths.team(team.id), team);
    tx.set(paths.member(member.uid), joined);
    tx.set(`${paths.team(team.id)}/members/${member.uid}`, joined);
    // Every approval, join and organizer close touches this document, serializing races.
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return { message: `You joined ${team.name}.` };
  }

  async directory(tx: Transaction, paths: EventPaths): Promise<FormationTeam[]> {
    const [teams, members] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), RULES.maxTeams + 1),
      tx.list<Member>(paths.collection('members'), 501),
    ]);
    return teams
      .filter((team) => team.eligibility === 'active')
      .slice(0, RULES.maxTeams)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((team) => ({
        id: team.id,
        name: team.name,
        members: members
          .filter(
            (entry) =>
              entry.teamId === team.id &&
              entry.status === 'approved' &&
              roles.includes(entry.role as FormationRole),
          )
          .map((entry) => ({ name: entry.displayName, role: entry.role as FormationRole })),
        availableRoles: this.availableRoles(members, team.id),
      }));
  }

  private availableRoles(members: Member[], teamId: string): FormationRole[] {
    return roles.filter(
      (role) =>
        role === 'member' ||
        !members.some(
          (entry) => entry.teamId === teamId && entry.status === 'approved' && entry.role === role,
        ),
    );
  }
}

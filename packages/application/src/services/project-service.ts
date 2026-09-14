import type {
  CommunityCommand,
  FundingRound,
  Member,
  ProjectSubmission,
  ProjectUpdate,
} from '@robinhacks/core';
import { requireState } from '../errors';
import { receipt, type CommandContext } from './context';
import { PlatformPermissions as Guard } from './platform-permissions';

type ProjectCommand = Extract<
  CommunityCommand,
  { type: 'publishUpdate' | 'setSubmissionWindow' | 'submitProject' }
>;

/** Progress is append-only; a final submission is a frozen copy of evidence and roster. */
export class ProjectService {
  async execute(context: CommandContext, command: ProjectCommand) {
    const { tx, paths, event, now } = context;
    if (command.type === 'setSubmissionWindow') {
      const config = Guard.organizer(context, command.expectedPhaseVersion);
      Guard.writable(context);
      requireState(
        config.currentRound < 3 && event.phase !== 'FROZEN',
        'SUBMISSIONS_LOCKED',
        'Submissions must finish before the final funding round.',
      );
      Guard.futureDeadline(command.open, command.closesAt, now);
      tx.set(paths.root, {
        ...event,
        phaseVersion: event.phaseVersion + 1,
        platform: {
          ...config,
          submissionsOpen: command.open,
          submissionClosesAt: command.open ? command.closesAt : null,
        },
      });
      return {
        receipt: receipt(
          context,
          command,
          command.open ? 'Final submissions opened.' : 'Final submissions closed.',
        ),
      };
    }

    const config = Guard.writable(context);
    const team = await Guard.writer(context);
    if (command.type === 'publishUpdate') {
      const rounds = await tx.list<FundingRound>(paths.collection('fundingRounds'), 4);
      requireState(
        Number.isInteger(command.round) && command.round >= 1 && command.round <= 3,
        'INVALID_ROUND',
        'Choose one of the three funding rounds.',
      );
      requireState(
        command.round > config.currentRound &&
          !rounds.some((round) => round.number >= command.round),
        'UPDATE_LOCKED',
        'Publish the checkpoint before its funding round opens.',
      );
      const [existing, previousId] = await Promise.all([
        tx.list<ProjectUpdate>(paths.collection('projectUpdates'), 301),
        tx.get<ProjectUpdate>(paths.doc('projectUpdates', command.commandId)),
      ]);
      // Command receipts are per actor; a different actor cannot reuse a public document ID.
      requireState(
        !previousId,
        'COMMAND_CONFLICT',
        'This update identifier already exists. Start a new update.',
      );
      requireState(
        existing.length < 300 && existing.filter((update) => update.teamId === team.id).length < 10,
        'UPDATE_LIMIT',
        'A project can publish up to ten progress updates.',
      );
      for (const [label, value] of Object.entries({
        works: command.works,
        changed: command.changed,
        incomplete: command.incomplete,
      }))
        requireState(
          (value.trim().length > 0 || (label === 'changed' && command.round === 1)) &&
            value.length <= 600,
          'INVALID_UPDATE',
          `Keep ${label} between 1 and 600 characters; the initial pitch may omit changes.`,
        );
      if (command.evidenceUrl) Guard.httpUrl(command.evidenceUrl, 'Evidence link');
      const update: ProjectUpdate = {
        id: command.commandId,
        teamId: team.id,
        round: command.round,
        works: command.works.trim(),
        changed: command.changed.trim(),
        evidenceUrl: command.evidenceUrl,
        incomplete: command.incomplete.trim(),
        createdAt: now,
        authorName: context.member.displayName,
      };
      tx.set(paths.doc('projectUpdates', update.id), update);
      return { receipt: receipt(context, command, 'Project update published.') };
    }

    Guard.deadline(config.submissionsOpen, config.submissionClosesAt, now, 'Final submissions');
    requireState(
      config.currentRound < 3,
      'SUBMISSIONS_LOCKED',
      'Final evidence must be submitted before the last funding round.',
    );
    requireState(
      team.version === command.expectedTeamVersion,
      'TEAM_CHANGED',
      'Your project changed. Refresh before submitting.',
    );
    requireState(
      !(await tx.get<ProjectSubmission>(paths.doc('submissions', team.id))),
      'ALREADY_SUBMITTED',
      'Your final submission is already locked.',
    );
    requireState(
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(command.commitSha),
      'COMMIT_REQUIRED',
      'Use the full 40- or 64-character Git commit identifier.',
    );
    requireState(
      team.name.trim() && team.pitch.trim() && team.problem.trim() && team.building.trim(),
      'PROFILE_INCOMPLETE',
      'Complete your project name, pitch, problem and implementation before submitting.',
    );
    Guard.httpUrl(team.repoUrl, 'Repository link');
    Guard.httpUrl(team.demoUrl, 'Demo link');
    requireState(
      command.techStack.length <= 300,
      'INVALID_SUBMISSION',
      'Keep the technology list under 300 characters.',
    );
    const members = await tx.list<Member>(paths.collection('members'), 501);
    const submission: ProjectSubmission = {
      id: team.id,
      teamId: team.id,
      submittedAt: now,
      submittedBy: context.actor.uid,
      name: team.name,
      pitch: team.pitch,
      problem: team.problem,
      building: team.building,
      demoUrl: team.demoUrl,
      repoUrl: team.repoUrl,
      commitSha: command.commitSha.toLowerCase(),
      techStack: command.techStack.trim(),
      roster: members
        .filter(
          (member) =>
            member.teamId === team.id &&
            member.status === 'approved' &&
            !['organizer', 'judge'].includes(member.role),
        )
        .map((member) => ({ uid: member.uid, name: member.displayName }))
        .sort((a, b) => a.uid.localeCompare(b.uid)),
    };
    tx.set(paths.doc('submissions', team.id), submission);
    return { receipt: receipt(context, command, 'Final project submission locked.') };
  }
}

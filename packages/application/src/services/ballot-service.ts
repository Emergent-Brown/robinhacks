import type {
  CommunityBallot,
  CommunityCommand,
  FundingRound,
  ProjectSubmission,
  Team,
} from '@robinhacks/core';
import { requireState } from '../errors';
import { receipt, type CommandContext } from './context';
import { PlatformPermissions as Guard } from './platform-permissions';

type BallotCommand = Extract<CommunityCommand, { type: 'setBallotWindow' | 'saveBallot' }>;

/** One private ballot per team; vote counts are read only when preparing final awards. */
export class BallotService {
  async execute(context: CommandContext, command: BallotCommand) {
    const { tx, paths, event, now } = context;
    if (command.type === 'setBallotWindow') {
      const config = Guard.organizer(context, command.expectedPhaseVersion);
      Guard.writable(context);
      requireState(
        event.phase === 'FROZEN',
        'JUDGING_REQUIRED',
        'Open the community ballot after funding has finished.',
      );
      const rounds = await tx.list<FundingRound>(paths.collection('fundingRounds'), 4);
      requireState(
        rounds.some((round) => round.number === 3 && round.state !== 'open') &&
          !rounds.some((round) => round.state === 'open'),
        'FUNDING_OPEN',
        'Close every funding round before opening the community ballot.',
      );
      Guard.futureDeadline(command.open, command.closesAt, now);
      tx.set(paths.root, {
        ...event,
        phaseVersion: event.phaseVersion + 1,
        platform: {
          ...config,
          ballotOpen: command.open,
          ballotClosesAt: command.open ? command.closesAt : null,
        },
      });
      return {
        receipt: receipt(
          context,
          command,
          command.open ? 'Community ballot opened.' : 'Community ballot closed.',
        ),
      };
    }

    const config = Guard.writable(context);
    const team = await Guard.writer(context);
    requireState(
      event.phase === 'FROZEN',
      'BALLOT_CLOSED',
      'Community voting is available after funding finishes.',
    );
    Guard.deadline(config.ballotOpen, config.ballotClosesAt, now, 'Community ballots');
    const [teams, submissions, prior] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
      tx.get<CommunityBallot>(paths.doc('communityBallots', team.id)),
    ]);
    requireState(
      (prior?.version ?? 0) === command.expectedVersion,
      'BALLOT_CHANGED',
      'A teammate changed this ballot. Refresh before saving.',
    );
    const submitted = new Set(submissions.map((submission) => submission.teamId));
    const eligible = teams.filter(
      (candidate) =>
        candidate.eligibility === 'active' &&
        submitted.has(candidate.id) &&
        candidate.id !== team.id,
    );
    requireState(
      eligible.length > 0,
      'NO_ELIGIBLE_PROJECTS',
      'There are no other submitted projects to rank.',
    );
    const ranks = command.rankedProjectIds;
    requireState(
      ranks.length === Math.min(3, eligible.length) &&
        new Set(ranks).size === ranks.length &&
        ranks.every((id) => eligible.some((candidate) => candidate.id === id)),
      'INVALID_BALLOT',
      `Rank ${Math.min(3, eligible.length)} different eligible projects, excluding your own.`,
    );
    const ballot: CommunityBallot = {
      teamId: team.id,
      rankedProjectIds: [...ranks],
      version: (prior?.version ?? 0) + 1,
      updatedAt: now,
    };
    tx.set(paths.doc('communityBallots', team.id), ballot);
    return { receipt: receipt(context, command, 'Community ballot saved privately.') };
  }
}

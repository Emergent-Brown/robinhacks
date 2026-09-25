import { isJudgingScore, JUDGING_SCORE_MAX, SealedFunding } from '@robinhacks/core';
import type {
  AwardResults,
  JudgeDecision,
  CommunityCommand,
  FundingRound,
  FundingSettings,
  JudgeAssignment,
  JudgingEntry,
  JudgingSheet,
  Member,
  ProjectSubmission,
  RoundEntitlement,
  Team,
} from '@robinhacks/core';
import { judgingReview } from './judging-review';
import { requireState } from '../errors';
import { receipt, type CommandContext } from './context';
import { PlatformPermissions as Guard } from './platform-permissions';

type JudgingCommand = Extract<
  CommunityCommand,
  {
    type:
      | 'setPitchOrder'
      | 'submitJudgeDecision'
      | 'assignJudge'
      | 'saveJudgingSheet'
      | 'beginJudging'
      | 'prepareAwards'
      | 'discardAwards'
      | 'publishAwards';
  }
>;
interface ScoredProject {
  teamId: string;
  numerator: bigint;
  denominator: bigint;
  judgeCount: number;
}

/** Independent score sheets and an explicit review boundary before any prize is published. */
export class JudgingService {
  async execute(context: CommandContext, command: JudgingCommand) {
    switch (command.type) {
      case 'setPitchOrder':
        return this.pitchOrder(context, command);
      case 'submitJudgeDecision':
        return this.decide(context, command);
      case 'assignJudge':
        return this.assign(context, command);
      case 'saveJudgingSheet':
        return this.save(context, command);
      case 'beginJudging':
        return this.begin(context, command);
      case 'prepareAwards':
        return this.prepare(context, command);
      case 'discardAwards':
        return this.discard(context, command);
      case 'publishAwards':
        return this.publish(context, command);
    }
  }

  private async pitchOrder(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'setPitchOrder' }>,
  ) {
    const config = Guard.organizer(context, command.expectedPhaseVersion);
    Guard.writable(context);
    const teams = await context.tx.list<Team>(context.paths.collection('teams'), 31);
    requireState(
      new Set(command.projectIds).size === command.projectIds.length &&
        command.projectIds.every((id) => teams.some((t) => t.id === id)),
      'INVALID_ORDER',
      'Choose each existing team at most once.',
    );
    context.tx.set(context.paths.root, {
      ...context.event,
      phaseVersion: context.event.phaseVersion + 1,
      platform: { ...config, pitchOrder: command.projectIds },
    });
    return { message: 'Pitch order saved.' };
  }

  private async decide(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'submitJudgeDecision' }>,
  ) {
    const { tx, paths, event, member, now } = context;
    const config = Guard.writable(context);
    requireState(
      member.role === 'judge' && member.teamId === null,
      'JUDGE_REQUIRED',
      'An assigned judge must submit the deliberation decision.',
    );
    requireState(
      event.phase === 'FROZEN' && event.phaseVersion === command.expectedPhaseVersion,
      'PHASE_CHANGED',
      'Refresh the judging review before submitting.',
    );
    const [teams, submissions, members, assignments, sheets] = await Promise.all([
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
      tx.list<Member>(paths.collection('members'), 501),
      tx.list<JudgeAssignment>(paths.collection('judgeAssignments'), 51),
      tx.list<JudgingSheet>(paths.collection('judgingSheets'), 51),
    ]);
    const review = judgingReview(teams, submissions, members, assignments, sheets, config.funding);
    requireState(
      review.ready,
      'JUDGING_INCOMPLETE',
      'All assigned judges must submit, and every eligible project needs a non-conflicted score.',
    );
    requireState(
      review.activeJudgeIds.includes(member.uid),
      'JUDGE_REQUIRED',
      'Only an assigned judge may submit the decision.',
    );
    requireState(
      review.projects.some((p) => p.teamId === command.winnerId),
      'INVALID_WINNER',
      'Choose an eligible submitted project.',
    );
    requireState(
      command.reason.trim().length >= 10,
      'REASON_REQUIRED',
      'Record the judges’ deliberation reason.',
    );
    const decision: JudgeDecision = {
      winnerId: command.winnerId,
      reason: command.reason.trim(),
      submittedBy: member.uid,
      submittedAt: now,
      evidenceKey: review.evidenceKey,
    };
    tx.set(paths.doc('judgeDecisions', 'current'), decision);
    tx.set(paths.doc('judgeDecisions', `${member.uid}__${command.commandId}`), decision);
    tx.set(paths.root, { ...event, phaseVersion: event.phaseVersion + 1 });
    return { message: 'Winner submitted for organizer approval.' };
  }

  private async assign(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'assignJudge' }>,
  ) {
    const { tx, paths } = context;
    Guard.organizer(context);
    Guard.writable(context);
    const [judge, prior, sheet, teams, assignments] = await Promise.all([
      tx.get<Member>(paths.member(command.uid)),
      tx.get<JudgeAssignment>(paths.doc('judgeAssignments', command.uid)),
      tx.get<JudgingSheet>(paths.doc('judgingSheets', command.uid)),
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<JudgeAssignment>(paths.collection('judgeAssignments'), 51),
    ]);
    requireState(
      judge?.status === 'approved' && judge.role === 'judge' && judge.teamId === null,
      'JUDGE_REQUIRED',
      'Assign a separate, approved judge account.',
    );
    requireState(
      assignments.length <= 50 && (prior !== null || assignments.length < 50),
      'JUDGE_LIMIT',
      'This event supports at most 50 judge assignment records.',
    );
    requireState(
      sheet?.submittedAt == null,
      'SHEET_LOCKED',
      'This judge has submitted their scores. Their assignment is locked.',
    );
    requireState(
      (prior?.version ?? 0) === command.expectedVersion,
      'ASSIGNMENT_CHANGED',
      'This assignment changed. Refresh before saving.',
    );
    requireState(
      command.projectIds.length <= 30 &&
        new Set(command.projectIds).size === command.projectIds.length &&
        command.projectIds.every((id) => teams.some((team) => team.id === id)),
      'INVALID_ASSIGNMENT',
      'Choose distinct projects from this event.',
    );
    requireState(
      new Set(command.conflictIds).size === command.conflictIds.length &&
        command.conflictIds.every((id) => command.projectIds.includes(id)),
      'INVALID_CONFLICT',
      'Conflicts must refer to assigned projects.',
    );
    tx.set<JudgeAssignment>(paths.doc('judgeAssignments', command.uid), {
      uid: command.uid,
      projectIds: [...command.projectIds],
      conflictIds: [...command.conflictIds],
      version: (prior?.version ?? 0) + 1,
    });
    // Preserve compatible draft work but discard entries removed from the assignment.
    if (sheet)
      tx.set(paths.doc('judgingSheets', command.uid), {
        ...sheet,
        entries: Object.fromEntries(
          Object.entries(sheet.entries).filter(([id]) => command.projectIds.includes(id)),
        ),
        version: sheet.version + 1,
        updatedAt: context.now,
      });
    tx.set(paths.root, {
      ...context.event,
      judgingRevision: (context.event.judgingRevision ?? 0) + 1,
    });
    return { receipt: receipt(context, command, 'Judge assignments saved.') };
  }

  private async save(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'saveJudgingSheet' }>,
  ) {
    const { tx, paths, member, event, now } = context;
    const config = Guard.writable(context);
    requireState(
      member.role === 'judge' && member.teamId === null,
      'JUDGE_REQUIRED',
      'Only an independent judge can enter scores.',
    );
    requireState(
      event.phase === 'FROZEN',
      'JUDGING_CLOSED',
      'Judging opens after the final funding round.',
    );
    const [assignment, prior, submissions, teams] = await Promise.all([
      tx.get<JudgeAssignment>(paths.doc('judgeAssignments', member.uid)),
      tx.get<JudgingSheet>(paths.doc('judgingSheets', member.uid)),
      tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
      tx.list<Team>(paths.collection('teams'), 31),
    ]);
    requireState(assignment, 'ASSIGNMENT_REQUIRED', 'Ask an organizer to assign projects first.');
    requireState(prior?.submittedAt == null, 'SHEET_LOCKED', 'Submitted scores are locked.');
    requireState(
      (prior?.version ?? 0) === command.expectedVersion,
      'SHEET_CHANGED',
      'Your score sheet changed in another tab. Refresh before saving.',
    );
    const eligible = new Set(
      teams
        .filter(
          (team) =>
            team.eligibility === 'active' &&
            submissions.some((submission) => submission.teamId === team.id),
        )
        .map((team) => team.id),
    );
    requireState(
      Object.keys(command.entries).every(
        (id) => assignment.projectIds.includes(id) && eligible.has(id),
      ),
      'UNASSIGNED_PROJECT',
      'Only score your assigned, eligible submitted projects.',
    );
    for (const [id, entry] of Object.entries(command.entries)) {
      this.validateEntry(
        entry,
        config.funding,
        command.submit && !assignment.conflictIds.includes(id),
      );
      requireState(
        !assignment.conflictIds.includes(id) || entry.conflict,
        'CONFLICT_REQUIRED',
        'A declared conflict cannot be scored.',
      );
    }
    if (command.submit)
      for (const id of assignment.projectIds.filter(
        (id) => eligible.has(id) && !assignment.conflictIds.includes(id),
      )) {
        const entry = command.entries[id];
        requireState(
          entry,
          'SCORES_INCOMPLETE',
          'Complete each assigned project or declare a conflict.',
        );
        this.validateEntry(entry, config.funding, true);
      }
    const sheet: JudgingSheet = {
      uid: member.uid,
      entries: structuredClone(command.entries),
      version: (prior?.version ?? 0) + 1,
      updatedAt: now,
      submittedAt: command.submit ? now : null,
    };
    tx.set(paths.doc('judgingSheets', member.uid), sheet);
    if (command.submit)
      tx.set(paths.root, {
        ...context.event,
        judgingRevision: (context.event.judgingRevision ?? 0) + 1,
      });
    return {
      receipt: receipt(
        context,
        command,
        command.submit ? 'Judging scores submitted and locked.' : 'Judging draft saved.',
      ),
    };
  }

  private validateEntry(entry: JudgingEntry, settings: FundingSettings, complete: boolean): void {
    requireState(
      typeof entry.conflict === 'boolean' && entry.note.length <= 1500,
      'INVALID_SCORES',
      'Keep judging notes at or below 1,500 characters.',
    );
    const rubricIds = new Set(settings.rubric.map((criterion) => criterion.id));
    requireState(
      Object.entries(entry.scores).every(
        ([id, score]) => rubricIds.has(id) && isJudgingScore(score),
      ),
      'INVALID_SCORES',
      `Use a whole-number score from 0 to ${JUDGING_SCORE_MAX} for each rubric criterion.`,
    );
    if (complete && entry.conflict)
      requireState(
        entry.note.trim().length >= 3,
        'CONFLICT_REASON_REQUIRED',
        'Explain the conflict briefly.',
      );
    else if (complete)
      requireState(
        settings.rubric.every((criterion) => Object.hasOwn(entry.scores, criterion.id)),
        'SCORES_INCOMPLETE',
        'Complete every rubric criterion before submitting.',
      );
  }

  private async begin(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'beginJudging' }>,
  ) {
    const { tx, paths, event } = context;
    const config = Guard.organizer(context, command.expectedPhaseVersion);
    Guard.writable(context);
    requireState(
      event.phase === 'INTERMISSION' && config.currentRound === 3,
      'FINAL_ROUND_REQUIRED',
      'Finish the final funding round before opening judging.',
    );
    await this.assertFundingFinished(context);
    tx.set(paths.root, {
      ...event,
      phase: 'FROZEN',
      phaseVersion: event.phaseVersion + 1,
      closesAt: null,
      platform: { ...config, submissionsOpen: false, submissionClosesAt: null },
    });
    return { receipt: receipt(context, command, 'Judging opened. Funding is finished.') };
  }

  private async prepare(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'prepareAwards' }>,
  ) {
    const { tx, paths, event, now } = context;
    const config = Guard.organizer(context, command.expectedPhaseVersion);
    Guard.writable(context);
    requireState(
      event.phase === 'FROZEN',
      'JUDGING_REQUIRED',
      'Open judging before preparing awards.',
    );
    requireState(
      command.commandId !== 'current',
      'COMMAND_CONFLICT',
      'This command identifier is reserved. Use a new request identifier.',
    );
    await this.assertFundingFinished(context);
    const [teams, members, submissions, assignments, sheets, entitlements, current, archived] =
      await Promise.all([
        tx.list<Team>(paths.collection('teams'), 31),
        tx.list<Member>(paths.collection('members'), 501),
        tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
        tx.list<JudgeAssignment>(paths.collection('judgeAssignments'), 51),
        tx.list<JudgingSheet>(paths.collection('judgingSheets'), 51),
        tx.list<RoundEntitlement>(paths.collection('roundEntitlements'), 91),
        tx.get<AwardResults>(paths.doc('awardResults', 'current')),
        tx.get<AwardResults>(paths.doc('awardResults', command.commandId)),
      ]);
    requireState(
      !current,
      'AWARDS_EXIST',
      'Discard the current preview before preparing another one.',
    );
    requireState(
      !archived,
      'COMMAND_CONFLICT',
      'An archived award preview already uses this request identifier. Use a new one.',
    );
    const eligible = teams.filter(
      (team) =>
        team.eligibility === 'active' &&
        submissions.some((submission) => submission.teamId === team.id),
    );
    requireState(
      eligible.length > 0,
      'NO_ELIGIBLE_PROJECTS',
      'At least one active project must have a final submission.',
    );
    const activeAssignments = assignments.filter((assignment) =>
      members.some(
        (member) =>
          member.uid === assignment.uid &&
          member.status === 'approved' &&
          member.role === 'judge' &&
          member.teamId === null,
      ),
    );
    for (const assignment of activeAssignments) {
      if (
        assignment.projectIds.some(
          (id) => eligible.some((team) => team.id === id) && !assignment.conflictIds.includes(id),
        )
      )
        requireState(
          sheets.some((sheet) => sheet.uid === assignment.uid && sheet.submittedAt !== null),
          'JUDGING_INCOMPLETE',
          'Every assigned judge must submit their score sheet.',
        );
    }
    const scored = eligible.map((team): ScoredProject => {
      let weightedTotal = 0n;
      let judgeCount = 0;
      for (const assignment of activeAssignments.filter(
        (assignment) =>
          assignment.projectIds.includes(team.id) && !assignment.conflictIds.includes(team.id),
      )) {
        const sheet = sheets.find(
          (sheet) => sheet.uid === assignment.uid && sheet.submittedAt !== null,
        );
        const entry = sheet?.entries[team.id];
        if (!entry || entry.conflict) continue;
        this.validateEntry(entry, config.funding, true);
        for (const criterion of config.funding.rubric)
          weightedTotal += BigInt(entry.scores[criterion.id]!) * BigInt(criterion.weight);
        judgeCount++;
      }
      requireState(
        judgeCount > 0,
        'PROJECT_UNJUDGED',
        `Assign a non-conflicted judge to ${team.name}.`,
      );
      return {
        teamId: team.id,
        numerator: weightedTotal,
        denominator: BigInt(
          judgeCount *
            config.funding.rubric.reduce((total, criterion) => total + criterion.weight, 0),
        ),
        judgeCount,
      };
    });
    const compare = (a: ScoredProject, b: ScoredProject) => {
      const difference = b.numerator * a.denominator - a.numerator * b.denominator;
      return difference > 0n ? 1 : difference < 0n ? -1 : 0;
    };
    scored.sort((a, b) => compare(a, b) || a.teamId.localeCompare(b.teamId));
    const decision = await tx.get<JudgeDecision>(paths.doc('judgeDecisions', 'current'));
    const review = judgingReview(teams, submissions, members, assignments, sheets, config.funding);
    requireState(
      decision &&
        review.ready &&
        review.evidenceKey === decision.evidenceKey &&
        review.activeJudgeIds.includes(decision.submittedBy),
      'DECISION_REQUIRED',
      'An assigned judge must submit a current deliberation decision before organizer approval.',
    );
    requireState(
      command.winnerId === decision.winnerId,
      'DECISION_CHANGED',
      'The judge decision changed. Refresh and review it.',
    );
    const winnerId = decision.winnerId;
    requireState(
      scored.some((p) => p.teamId === winnerId),
      'INVALID_WINNER',
      'Choose an eligible submitted project.',
    );
    const winner = scored.find((project) => project.teamId === winnerId)!;
    const ranking = [winner, ...scored.filter((project) => project !== winner)];
    const community: AwardResults['community'] = [];
    const payableEntitlements = entitlements.filter((entitlement) =>
      teams.some((team) => team.id === entitlement.teamId && team.eligibility !== 'disqualified'),
    );
    const payout = SealedFunding.payoff(
      payableEntitlements,
      winnerId,
      config.funding.investorPoolMinor,
    );
    const awards: AwardResults = {
      id: command.commandId,
      judgeDecision: decision,
      createdAt: now,
      publishAfter: now + config.funding.reviewMinutes * 60_000,
      publishedAt: null,
      winnerId,
      tiebreakReason: decision.reason,
      projects: ranking.map((project, index) => ({
        teamId: project.teamId,
        score: Number(project.numerator) / Number(project.denominator),
        judgeCount: project.judgeCount,
        rank: index + 1,
        builderPrizeMinor: index === 0 ? (config.funding.builderPrizesMinor[0] ?? 0) : 0,
      })),
      ...payout,
      community,
      communityWinnerId: community.find((project) => project.points > 0)?.teamId ?? null,
      settings: structuredClone(config.funding),
    };
    tx.set(paths.doc('awardResults', 'current'), awards);
    tx.set(paths.doc('awardResults', awards.id), awards);
    tx.set(paths.root, {
      ...event,
      phase: 'FINALIZING',
      phaseVersion: event.phaseVersion + 1,
      closesAt: null,
      platform: {
        ...config,
        ballotOpen: false,
        ballotClosesAt: null,
        submissionsOpen: false,
        submissionClosesAt: null,
      },
    });
    return {
      receipt: receipt(
        context,
        command,
        'Awards prepared for review. Nothing has been paid or published.',
      ),
    };
  }

  private async assertFundingFinished(context: CommandContext): Promise<void> {
    const rounds = await context.tx.list<FundingRound>(
      context.paths.collection('fundingRounds'),
      4,
    );
    requireState(
      rounds.length === 3 &&
        rounds.every((round) => round.state !== 'open') &&
        rounds.some((round) => round.number === 3),
      'FUNDING_OPEN',
      'Finish all three funding rounds first.',
    );
  }

  private async discard(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'discardAwards' }>,
  ) {
    const { tx, paths, event } = context;
    Guard.organizer(context, command.expectedPhaseVersion);
    const awards = await tx.get<AwardResults>(paths.doc('awardResults', 'current'));
    requireState(
      event.phase === 'FINALIZING' && awards && awards.publishedAt === null,
      'AWARDS_LOCKED',
      'Only an unpublished award preview can be discarded.',
    );
    requireState(
      command.reason.trim().length >= 10 && command.reason.length <= 500,
      'REASON_REQUIRED',
      'Record why this award preview is being discarded.',
    );
    // The archived preview and command audit remain; public results never disappear.
    tx.delete(paths.doc('awardResults', 'current'));
    tx.set(paths.root, { ...event, phase: 'FROZEN', phaseVersion: event.phaseVersion + 1 });
    return {
      receipt: receipt(context, command, `Award preview discarded: ${command.reason.trim()}`),
    };
  }

  private async publish(
    context: CommandContext,
    command: Extract<JudgingCommand, { type: 'publishAwards' }>,
  ) {
    const { tx, paths, event, now } = context;
    Guard.organizer(context, command.expectedPhaseVersion);
    requireState(!event.paused, 'EVENT_PAUSED', 'Resume the event before publishing results.');
    const [awards, teams, submissions] = await Promise.all([
      tx.get<AwardResults>(paths.doc('awardResults', 'current')),
      tx.list<Team>(paths.collection('teams'), 31),
      tx.list<ProjectSubmission>(paths.collection('submissions'), 31),
    ]);
    requireState(
      event.phase === 'FINALIZING' && awards && awards.publishedAt === null,
      'AWARDS_NOT_READY',
      'Prepare an award preview first.',
    );
    requireState(
      now >= awards.publishAfter,
      'REVIEW_PENDING',
      'The published results-review period has not ended yet.',
    );
    const eligible = teams.filter(
      (team) =>
        team.eligibility === 'active' &&
        submissions.some((submission) => submission.teamId === team.id),
    );
    requireState(
      eligible.length === awards.projects.length &&
        eligible.every((team) => awards.projects.some((project) => project.teamId === team.id)),
      'ELIGIBILITY_CHANGED',
      'Eligibility changed. Discard this preview and prepare awards again.',
    );
    const published = { ...awards, publishedAt: now };
    tx.set(paths.doc('awardResults', 'current'), published);
    tx.set(paths.doc('awardResults', awards.id), published);
    tx.set(paths.root, {
      ...event,
      phase: 'FINALIZED',
      phaseVersion: event.phaseVersion + 1,
      publishedResultId: awards.id,
    });
    return {
      receipt: receipt(
        context,
        command,
        'Final judging and investor results published. Prize distribution is handled by the organizers.',
      ),
    };
  }
}

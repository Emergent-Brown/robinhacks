/** Offline v2 ledger verification. Deliberately independent of the application's arithmetic. */
const MAX = Number.MAX_SAFE_INTEGER;
const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const integer = (value, min = 0, max = MAX) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    record(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
function rows(data, key, maximum) {
  check(
    Array.isArray(data[key]) && data[key].length <= maximum,
    `INVALID_${key.toUpperCase()}_COLLECTION`,
  );
  check(data[key].every(record), `INVALID_${key.toUpperCase()}_RECORD`);
  return data[key];
}
function indexed(items, key, code) {
  const map = new Map();
  for (const item of items) {
    check(typeof item[key] === 'string' && item[key].length > 0 && !map.has(item[key]), code);
    map.set(item[key], item);
  }
  return map;
}
function fractionAdd(a, b) {
  const n = a.n * b.d + b.n * a.d;
  const d = a.d * b.d;
  let first = n;
  let second = d;
  while (second) [first, second] = [second, first % second];
  return { n: n / first, d: d / first };
}
function settingsValid(settings) {
  check(record(settings), 'FUNDING_SETTINGS_MISSING');
  check(
    integer(settings.budget, 1, 10_000) &&
      integer(settings.increment, 1) &&
      integer(settings.maxPerProject, 1, settings.budget - 1) &&
      settings.budget % settings.increment === 0 &&
      settings.maxPerProject % settings.increment === 0 &&
      integer(settings.minimumDenominator, settings.budget, 1_000_000),
    'INVALID_ALLOCATION_RULES',
  );
  check(
    Array.isArray(settings.roundWeightsBps) &&
      settings.roundWeightsBps.length === 3 &&
      settings.roundWeightsBps.every((weight) => integer(weight, 1, 10_000)) &&
      settings.roundWeightsBps.reduce((sum, weight) => sum + weight, 0) === 10_000 &&
      Array.isArray(settings.roundNames) &&
      settings.roundNames.length === 3,
    'INVALID_ROUND_RESERVES',
  );
  check(
    integer(settings.investorPoolMinor) &&
      Array.isArray(settings.builderPrizesMinor) &&
      settings.builderPrizesMinor.length === 3 &&
      settings.builderPrizesMinor.every((amount) => integer(amount)) &&
      integer(settings.communityPrizeMinor) &&
      settings.currency === 'USD',
    'INVALID_PRIZE_SETTINGS',
  );
  check(
    typeof settings.reservePolicy === 'string' &&
      settings.reservePolicy.trim().length > 0 &&
      integer(settings.reviewMinutes, 1),
    'INVALID_REVIEW_OR_RESERVE_POLICY',
  );
  check(
    Array.isArray(settings.rubric) &&
      settings.rubric.length >= 1 &&
      settings.rubric.length <= 10 &&
      settings.rubric.every(
        (criterion) =>
          record(criterion) &&
          typeof criterion.id === 'string' &&
          integer(criterion.weight, 1, 100),
      ) &&
      new Set(settings.rubric.map((criterion) => criterion.id)).size === settings.rubric.length &&
      settings.rubric.reduce((sum, criterion) => sum + criterion.weight, 0) === 100,
    'INVALID_JUDGING_RUBRIC',
  );
}

function validateFunding(data, event, teams, settings) {
  const rounds = [...rows(data, 'fundingRounds', 3)].sort((a, b) => a.number - b.number);
  const sheets = indexed(rows(data, 'roundAllocations', 90), 'id', 'DUPLICATE_ALLOCATION');
  const entitlements = indexed(rows(data, 'roundEntitlements', 90), 'id', 'DUPLICATE_ENTITLEMENT');
  const members = indexed(rows(data, 'members', 500), 'uid', 'DUPLICATE_MEMBER');
  const submissions = indexed(rows(data, 'submissions', 30), 'teamId', 'DUPLICATE_SUBMISSION');
  check(
    [...submissions.keys()].every((id) => teams.has(id)),
    'ORPHAN_SUBMISSION',
  );
  check(
    integer(event.platform.currentRound, 0, 3) && rounds.length === event.platform.currentRound,
    'ROUND_COUNT_MISMATCH',
  );
  check(!rounds.length || integer(event.platform.rulesLockedAt), 'RULES_NOT_LOCKED');
  const seenSheets = new Set();
  const seenEntitlements = new Set();
  let previousRoster = new Set(teams.keys());
  for (const [index, round] of rounds.entries()) {
    check(
      round.number === index + 1 && round.id === `funding-${round.number}`,
      'INVALID_ROUND_SEQUENCE',
    );
    check(['closed', 'void'].includes(round.state), 'OPEN_ROUND_MUST_REMAIN_SEALED');
    check(
      integer(round.openedAt) &&
        integer(round.closesAt, round.openedAt + 1) &&
        event.platform.rulesLockedAt <= round.openedAt &&
        integer(round.version, 1),
      'INVALID_ROUND_TIMESTAMPS',
    );
    check(
      round.name === settings.roundNames[index] &&
        round.weightBps === settings.roundWeightsBps[index] &&
        round.minimumDenominator === settings.minimumDenominator,
      'FROZEN_ROUND_RULES_MISMATCH',
    );
    check(
      Array.isArray(round.eligibleTeamIds) &&
        round.eligibleTeamIds.length >= 2 &&
        round.eligibleTeamIds.length <= 30 &&
        new Set(round.eligibleTeamIds).size === round.eligibleTeamIds.length &&
        round.eligibleTeamIds.every((id) => teams.has(id) && previousRoster.has(id)),
      'INVALID_FROZEN_ROSTER',
    );
    previousRoster = new Set(round.eligibleTeamIds);
    check(
      round.number !== 3 || round.eligibleTeamIds.every((id) => submissions.has(id)),
      'FINAL_ROUND_SUBMISSION_MISSING',
    );
    const unrevealedVoid = round.state === 'void' && round.closedAt === null;
    check(!unrevealedVoid || event.phase === 'CANCELLED', 'UNREVEALED_VOID_REQUIRES_CANCELLATION');
    check(
      unrevealedVoid || integer(round.closedAt, round.closesAt),
      'ROUND_CLOSED_BEFORE_DEADLINE',
    );
    check(
      round.state !== 'void' ||
        (typeof round.voidReason === 'string' && round.voidReason.trim().length > 0),
      'VOID_REASON_MISSING',
    );
    const totals = new Map(round.eligibleTeamIds.map((id) => [id, 0]));
    const allocated = new Map();
    for (const teamId of round.eligibleTeamIds) {
      const id = `${round.id}__${teamId}`;
      const sheet = sheets.get(id);
      const amounts = sheet?.amounts ?? {};
      check(record(amounts) && Object.keys(amounts).length <= 30, 'INVALID_ALLOCATION_AMOUNTS');
      if (sheet) {
        seenSheets.add(id);
        check(
          sheet.roundId === round.id &&
            sheet.teamId === teamId &&
            integer(sheet.version, 1) &&
            integer(sheet.updatedAt, round.openedAt, round.closesAt - 1) &&
            typeof sheet.actorUid === 'string',
          'ALLOCATION_IDENTITY_OR_TIME_MISMATCH',
        );
        const actor = members.get(sheet.actorUid);
        check(
          actor && actor.teamId === teamId && ['captain', 'trader'].includes(actor.role),
          'ALLOCATION_ACTOR_MISMATCH',
        );
      }
      let spent = 0;
      for (const [projectId, credits] of Object.entries(amounts)) {
        check(
          projectId !== teamId &&
            totals.has(projectId) &&
            integer(credits, 1, settings.maxPerProject) &&
            credits % settings.increment === 0,
          'INVALID_PROJECT_ALLOCATION',
        );
        spent += credits;
        totals.set(projectId, totals.get(projectId) + credits);
      }
      check(spent <= settings.budget, 'ROUND_BUDGET_EXCEEDED');
      allocated.set(teamId, { amounts, spent });
    }
    check(record(round.totals), 'ROUND_TOTALS_MISSING');
    check(
      canonical(round.totals) === canonical(unrevealedVoid ? {} : Object.fromEntries(totals)),
      'ROUND_TOTALS_MISMATCH',
    );
    for (const teamId of round.eligibleTeamIds) {
      const id = `${round.id}__${teamId}`;
      const entitlement = entitlements.get(id);
      if (unrevealedVoid) {
        check(!entitlement, 'UNREVEALED_VOID_HAS_CLAIMS');
        continue;
      }
      check(entitlement, 'MISSING_ROUND_ENTITLEMENT');
      seenEntitlements.add(id);
      const { amounts, spent } = allocated.get(teamId);
      check(
        entitlement.roundId === round.id &&
          entitlement.roundNumber === round.number &&
          entitlement.teamId === teamId &&
          entitlement.awardedAt === round.closedAt &&
          entitlement.spent === spent &&
          entitlement.expired === settings.budget - spent &&
          entitlement.voided === (round.state === 'void'),
        'ENTITLEMENT_IDENTITY_OR_BUDGET_MISMATCH',
      );
      check(
        Array.isArray(entitlement.projects) &&
          entitlement.projects.length === Object.keys(amounts).length,
        'ENTITLEMENT_PROJECT_COUNT_MISMATCH',
      );
      const claims = indexed(entitlement.projects, 'projectId', 'DUPLICATE_PROJECT_ENTITLEMENT');
      for (const [projectId, credits] of Object.entries(amounts)) {
        const claim = claims.get(projectId);
        check(
          claim &&
            claim.credits === credits &&
            claim.total === totals.get(projectId) &&
            claim.denominator === Math.max(settings.minimumDenominator, totals.get(projectId)) &&
            claim.weightBps === settings.roundWeightsBps[index],
          'ENTITLEMENT_RATIONAL_TERMS_MISMATCH',
        );
      }
    }
  }
  check(seenSheets.size === sheets.size, 'ORPHAN_ALLOCATION');
  check(seenEntitlements.size === entitlements.size, 'ORPHAN_ENTITLEMENT');
  return { rounds, entitlements: [...entitlements.values()] };
}

function validatePublishedAwards(data, event, teams, settings, entitlements, rounds) {
  const allAwards = rows(data, 'awardResults', 1000);
  const unique = new Map();
  const counts = new Map();
  for (const awards of allAwards) {
    check(typeof awards.id === 'string' && awards.id.length > 0, 'AWARDS_ID_MISSING');
    const prior = unique.get(awards.id);
    check(!prior || canonical(prior) === canonical(awards), 'CONFLICTING_AWARDS_COPIES');
    counts.set(awards.id, (counts.get(awards.id) ?? 0) + 1);
    check(counts.get(awards.id) <= 2, 'DUPLICATE_AWARDS_RECORD');
    check(canonical(awards.settings) === canonical(settings), 'AWARDS_FROZEN_SETTINGS_MISMATCH');
    unique.set(awards.id, awards);
  }
  const published = [...unique.values()].filter((awards) => awards.publishedAt !== null);
  if (!['FINALIZED', 'ARCHIVED'].includes(event.phase)) {
    check(
      event.phase === 'CANCELLED' && !event.publishedResultId && !published.length,
      'EXPORT_STATE_OR_PUBLICATION_MISMATCH',
    );
    return null;
  }
  check(
    rounds.length === 3 && published.length === 1 && published[0].id === event.publishedResultId,
    'PUBLISHED_AWARDS_MISSING_OR_DUPLICATE',
  );
  const awards = published[0];
  check(
    integer(awards.createdAt) &&
      awards.publishAfter === awards.createdAt + settings.reviewMinutes * 60_000 &&
      integer(awards.publishedAt, awards.publishAfter),
    'AWARDS_REVIEW_PERIOD_MISMATCH',
  );
  const submissions = indexed(rows(data, 'submissions', 30), 'teamId', 'DUPLICATE_SUBMISSION');
  check(
    [...submissions.keys()].every((id) => teams.has(id)),
    'ORPHAN_SUBMISSION',
  );
  const eligible = [...teams.values()].filter(
    (team) => team.eligibility === 'active' && submissions.has(team.id),
  );
  check(
    eligible.some((team) => team.id === awards.winnerId),
    'WINNER_NOT_ELIGIBLE_OR_SUBMITTED',
  );
  const members = indexed(rows(data, 'members', 500), 'uid', 'DUPLICATE_MEMBER');
  const assignments = indexed(
    rows(data, 'judgeAssignments', 50),
    'uid',
    'DUPLICATE_JUDGE_ASSIGNMENT',
  );
  const sheets = indexed(rows(data, 'judgingSheets', 50), 'uid', 'DUPLICATE_JUDGING_SHEET');
  const activeJudges = [...assignments.values()].filter((assignment) => {
    const judge = members.get(assignment.uid);
    return judge?.status === 'approved' && judge.role === 'judge' && judge.teamId === null;
  });
  const scored = eligible.map((team) => {
    let total = 0n;
    let count = 0;
    for (const assignment of activeJudges) {
      check(
        Array.isArray(assignment.projectIds) &&
          Array.isArray(assignment.conflictIds) &&
          new Set(assignment.projectIds).size === assignment.projectIds.length &&
          assignment.projectIds.every((id) => teams.has(id)) &&
          assignment.conflictIds.every((id) => assignment.projectIds.includes(id)),
        'INVALID_JUDGE_ASSIGNMENT',
      );
      if (!assignment.projectIds.includes(team.id) || assignment.conflictIds.includes(team.id))
        continue;
      const sheet = sheets.get(assignment.uid);
      check(
        sheet && integer(sheet.submittedAt) && sheet.submittedAt <= awards.createdAt,
        'JUDGING_NOT_SUBMITTED',
      );
      const entry = sheet.entries?.[team.id];
      check(entry && typeof entry.conflict === 'boolean', 'MISSING_JUDGING_ENTRY');
      if (entry.conflict) continue;
      check(
        record(entry.scores) &&
          Object.keys(entry.scores).length === settings.rubric.length &&
          settings.rubric.every((criterion) => integer(entry.scores[criterion.id], 0, 5)),
        'INVALID_RUBRIC_SCORES',
      );
      for (const criterion of settings.rubric)
        total += BigInt(entry.scores[criterion.id]) * BigInt(criterion.weight);
      count++;
    }
    check(count > 0, 'PROJECT_WITHOUT_INDEPENDENT_SCORE');
    return { teamId: team.id, n: total, d: BigInt(count * 100), judgeCount: count };
  });
  const compare = (a, b) => {
    const difference = b.n * a.d - a.n * b.d;
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  };
  scored.sort((a, b) => compare(a, b) || a.teamId.localeCompare(b.teamId));
  const tied = scored.filter((project) => compare(project, scored[0]) === 0);
  check(
    tied.some((project) => project.teamId === awards.winnerId),
    'WINNER_NOT_HIGHEST_JUDGED_SCORE',
  );
  check(
    tied.length === 1 ||
      (typeof awards.tiebreakReason === 'string' && awards.tiebreakReason.trim().length >= 10),
    'TIEBREAK_REASON_MISSING',
  );
  const ordered = [
    scored.find((project) => project.teamId === awards.winnerId),
    ...scored.filter((project) => project.teamId !== awards.winnerId),
  ];
  check(
    Array.isArray(awards.projects) && awards.projects.length === ordered.length,
    'BUILDER_RESULT_COUNT_MISMATCH',
  );
  for (const [index, project] of ordered.entries()) {
    const actual = awards.projects[index];
    check(
      actual.teamId === project.teamId &&
        actual.score === Number(project.n) / Number(project.d) &&
        actual.judgeCount === project.judgeCount &&
        actual.rank === index + 1 &&
        actual.builderPrizeMinor === (settings.builderPrizesMinor[index] ?? 0),
      'JUDGED_BUILDER_RESULTS_MISMATCH',
    );
  }
  const claims = new Map();
  for (const entitlement of entitlements) {
    if (teams.get(entitlement.teamId).eligibility === 'disqualified') continue;
    if (!claims.has(entitlement.teamId)) claims.set(entitlement.teamId, { n: 0n, d: 1n });
    if (entitlement.voided) continue;
    for (const project of entitlement.projects.filter(
      (claim) => claim.projectId === awards.winnerId,
    )) {
      claims.set(
        entitlement.teamId,
        fractionAdd(claims.get(entitlement.teamId), {
          n: BigInt(project.credits) * BigInt(project.weightBps),
          d: BigInt(project.denominator) * 10_000n,
        }),
      );
    }
  }
  check(Array.isArray(awards.investors), 'INVESTOR_RESULTS_MISSING');
  const investors = indexed(awards.investors, 'teamId', 'DUPLICATE_INVESTOR_RESULT');
  check(investors.size === claims.size, 'INVESTOR_RESULT_COUNT_MISMATCH');
  let paid = 0n;
  for (const [teamId, fraction] of claims) {
    const investor = investors.get(teamId);
    const reward = (BigInt(settings.investorPoolMinor) * fraction.n) / fraction.d;
    check(
      investor &&
        integer(investor.rewardMinor) &&
        BigInt(investor.rewardMinor) === reward &&
        investor.entitlementPercent === (Number(fraction.n) * 100) / Number(fraction.d),
      'INVESTOR_REWARD_MISMATCH',
    );
    paid += reward;
  }
  check(
    paid <= BigInt(settings.investorPoolMinor) &&
      awards.investorPaidMinor === Number(paid) &&
      awards.reserveMinor === settings.investorPoolMinor - Number(paid),
    'INVESTOR_RESERVE_MISMATCH',
  );
  const ballots = indexed(
    rows(data, 'communityBallots', 30),
    'teamId',
    'DUPLICATE_COMMUNITY_BALLOT',
  );
  const tallies = new Map(
    eligible.map((team) => [team.id, { teamId: team.id, points: 0, firstChoices: 0, rank: 0 }]),
  );
  for (const ballot of ballots.values()) {
    check(
      teams.has(ballot.teamId) &&
        Array.isArray(ballot.rankedProjectIds) &&
        ballot.rankedProjectIds.length <= 3 &&
        new Set(ballot.rankedProjectIds).size === ballot.rankedProjectIds.length &&
        ballot.rankedProjectIds.every((id) => teams.has(id) && id !== ballot.teamId),
      'INVALID_COMMUNITY_BALLOT',
    );
    if (teams.get(ballot.teamId).eligibility === 'disqualified') continue;
    ballot.rankedProjectIds.forEach((id, index) => {
      const tally = tallies.get(id);
      if (!tally) return;
      tally.points += 3 - index;
      if (index === 0) tally.firstChoices++;
    });
  }
  const community = [...tallies.values()]
    .sort(
      (a, b) =>
        b.points - a.points || b.firstChoices - a.firstChoices || a.teamId.localeCompare(b.teamId),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
  check(
    canonical(awards.community) === canonical(community) &&
      awards.communityWinnerId === (community.find((row) => row.points > 0)?.teamId ?? null),
    'COMMUNITY_RESULTS_MISMATCH',
  );
  return {
    investorPaidMinor: Number(paid),
    reserveMinor: settings.investorPoolMinor - Number(paid),
  };
}

/** Returns counts and error codes only; never logs private allocations, identities, or notes. */
export function reconcileSealedExport(data) {
  const report = {
    valid: false,
    schemaVersion: 2,
    teams: 0,
    rounds: 0,
    entitlements: 0,
    publishedAwards: false,
    errors: [],
  };
  try {
    check(record(data) && data.schemaVersion === 2, 'EXPECTED_SCHEMA_VERSION_2');
    const event = data.event;
    check(
      record(event) && event.rulesVersion === 2 && event.platform?.version === 2,
      'INVALID_PLATFORM_EVENT',
    );
    const settings = event.platform.funding;
    settingsValid(settings);
    const teams = indexed(rows(data, 'teams', 30), 'id', 'DUPLICATE_TEAM');
    check(
      [...teams.values()].every((team) =>
        ['active', 'withdrawn', 'disqualified'].includes(team.eligibility),
      ),
      'INVALID_TEAM_ELIGIBILITY',
    );
    const funding = validateFunding(data, event, teams, settings);
    const payout = validatePublishedAwards(
      data,
      event,
      teams,
      settings,
      funding.entitlements,
      funding.rounds,
    );
    return {
      ...report,
      valid: true,
      teams: teams.size,
      rounds: funding.rounds.length,
      entitlements: funding.entitlements.length,
      publishedAwards: payout !== null,
      ...(payout ?? {}),
    };
  } catch (error) {
    report.errors.push(
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : 'MALFORMED_EXPORT',
    );
    return report;
  }
}

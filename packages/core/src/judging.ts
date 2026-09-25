import type { JudgeAssignment, JudgingMode, ProjectSubmission } from './platform';
import type { Member, Team } from './types';

/** Published judging scale. Rubric weights determine each criterion's contribution. */
export const JUDGING_SCORE_MAX = 5;

export function isJudgingScore(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= JUDGING_SCORE_MAX
  );
}

/** Resolve judging scope without storing a duplicate assignment for every judge/project pair. */
export function effectiveJudgeAssignments(
  mode: JudgingMode,
  members: Member[],
  teams: Team[],
  submissions: ProjectSubmission[],
  assignments: JudgeAssignment[],
): JudgeAssignment[] {
  const judges = members.filter(
    (m) => m.status === 'approved' && m.role === 'judge' && m.teamId === null,
  );
  if (mode === 'assigned') return assignments.filter((a) => judges.some((m) => m.uid === a.uid));
  const projectIds = teams
    .filter((t) => t.eligibility === 'active' && submissions.some((s) => s.teamId === t.id))
    .map((t) => t.id)
    .sort();
  return judges.map((judge) => {
    const stored = assignments.find((a) => a.uid === judge.uid);
    return {
      uid: judge.uid,
      projectIds,
      conflictIds: (stored?.conflictIds ?? []).filter((id) => projectIds.includes(id)),
      version: stored?.version ?? 0,
    };
  });
}

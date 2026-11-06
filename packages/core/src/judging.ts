import type { JudgeAssignment, ProjectSubmission } from './platform';
import type { Member, Team } from './types';

/** Published judging scale. Rubric weights determine each criterion's contribution. */
export const JUDGING_SCORE_MAX = 5;

export function isJudgingScore(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= JUDGING_SCORE_MAX
  );
}

/** Stored assignments are the single authority for which projects a judge rates. */
export function effectiveJudgeAssignments(
  members: Member[],
  teams: Team[],
  submissions: ProjectSubmission[],
  assignments: JudgeAssignment[],
): JudgeAssignment[] {
  const judges = members.filter(
    (m) => m.status === 'approved' && m.role === 'judge' && m.teamId === null,
  );
  const eligible = new Set(
    teams
      .filter((t) => t.eligibility === 'active' && submissions.some((s) => s.teamId === t.id))
      .map((t) => t.id),
  );
  return assignments
    .filter((a) => judges.some((m) => m.uid === a.uid))
    .map((a) => ({
      ...a,
      projectIds: a.projectIds.filter((id) => eligible.has(id)),
      conflictIds: a.conflictIds.filter((id) => eligible.has(id)),
    }));
}

import { effectiveJudgeAssignments, isJudgingScore, type JudgingMode } from '@robinhacks/core';
import type {
  FundingSettings,
  JudgeAssignment,
  JudgingSheet,
  Member,
  ProjectSubmission,
  Team,
} from '@robinhacks/core';

/** Shared definition of complete judging, used for deliberation and final approval. */
export function judgingReview(
  teams: Team[],
  submissions: ProjectSubmission[],
  members: Member[],
  assignments: JudgeAssignment[],
  sheets: JudgingSheet[],
  funding: FundingSettings,
  mode: JudgingMode = 'assigned',
) {
  const eligible = teams.filter(
    (t) => t.eligibility === 'active' && submissions.some((s) => s.teamId === t.id),
  );
  const active = effectiveJudgeAssignments(mode, members, teams, submissions, assignments);
  const required = active.filter((a) =>
    a.projectIds.some((id) => eligible.some((t) => t.id === id) && !a.conflictIds.includes(id)),
  );
  const weight = funding.rubric.reduce((sum, c) => sum + c.weight, 0);
  const projects = eligible
    .map((team) => {
      const entries = active
        .filter((a) => a.projectIds.includes(team.id) && !a.conflictIds.includes(team.id))
        .flatMap((a) => {
          const sheet = sheets.find((s) => s.uid === a.uid && s.submittedAt !== null);
          const entry = sheet?.entries[team.id];
          return entry && !entry.conflict ? [{ uid: a.uid, ...entry }] : [];
        });
      const score =
        entries.reduce(
          (sum, e) =>
            sum + funding.rubric.reduce((n, c) => n + (e.scores[c.id] ?? 0) * c.weight, 0),
          0,
        ) / (entries.length * weight || 1);
      return { teamId: team.id, score, judgeCount: entries.length, entries };
    })
    .sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
  const ready =
    projects.length > 0 &&
    projects.every((p) => p.judgeCount > 0) &&
    required.every((a) => {
      const sheet = sheets.find((s) => s.uid === a.uid && s.submittedAt !== null);
      return (
        sheet &&
        a.projectIds
          .filter((id) => eligible.some((t) => t.id === id) && !a.conflictIds.includes(id))
          .every((id) => {
            const entry = sheet.entries[id];
            return (
              entry &&
              (entry.conflict
                ? entry.note.trim().length >= 3
                : funding.rubric.every((c) => isJudgingScore(entry.scores[c.id])))
            );
          })
      );
    });
  // Versions make a decision stale after any corrected score, assignment or submission.
  const evidenceKey = JSON.stringify({
    ...(mode === 'all' ? { judgingMode: mode } : {}),
    teams: eligible.map((t) => [t.id, t.version]).sort(),
    submissions: submissions.map((s) => [s.teamId, s.submittedAt]).sort(),
    assignments: active.map((a) => [a.uid, a.version]).sort(),
    sheets: sheets
      .filter((s) => active.some((a) => a.uid === s.uid))
      .map((s) => [s.uid, s.version, s.submittedAt])
      .sort(),
    rubric: funding.rubric,
  });
  return {
    ready,
    projects,
    evidenceKey,
    activeJudgeIds: active.filter((a) => a.projectIds.length > 0).map((a) => a.uid),
  };
}

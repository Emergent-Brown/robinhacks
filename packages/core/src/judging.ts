/** Published judging scale. Rubric weights determine each criterion's contribution. */
export const JUDGING_SCORE_MAX = 5;

export function isJudgingScore(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= JUDGING_SCORE_MAX
  );
}

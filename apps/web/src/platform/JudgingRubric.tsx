import { JUDGING_SCORE_MAX, type FundingSettings } from '@robinhacks/core';
import './judging-rubric.css';

/** The public scorecard reads the same criteria and weights used by judges. */
export function JudgingRubric({ funding }: { funding: FundingSettings }) {
  return (
    <div className="p-public-rubric">
      <p>
        Judges score each component from 0 to {JUDGING_SCORE_MAX}. The weighted average determines
        the final score. Investment totals don’t affect judging.
      </p>
      <div className="p-table-wrap">
        <table className="p-table">
          <caption className="sr-only">Emergent Hacks judging rubric</caption>
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Weight</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {funding.rubric.map((criterion) => (
              <tr key={criterion.id}>
                <th scope="row">{criterion.label}</th>
                <td>{criterion.weight}%</td>
                <td>0–{JUDGING_SCORE_MAX}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

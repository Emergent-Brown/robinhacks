import type { EventConfig } from './types';
import type { FundingRound, ProjectUpdate } from './platform';

export class CheckpointPolicy {
  static windowOpen(event: EventConfig, rounds: FundingRound[], number: number): boolean {
    const current = event.platform?.currentRound;
    if (
      current === undefined ||
      event.paused ||
      event.maintenance ||
      event.activeOperationId ||
      ['FINALIZING', 'FINALIZED', 'CANCELLED', 'ARCHIVED'].includes(event.phase)
    )
      return false;
    if (number > current) return !rounds.some((round) => round.number >= number);
    return (
      number === current &&
      event.phase === 'SEED_OPEN' &&
      rounds.some((round) => round.number === number && round.state === 'open')
    );
  }

  /** During funding, only a team's first checkpoint for that round may be published. */
  static canPublish(
    event: EventConfig,
    rounds: FundingRound[],
    updates: ProjectUpdate[],
    teamId: string,
    number: number,
  ): boolean {
    return (
      this.windowOpen(event, rounds, number) &&
      (number !== event.platform?.currentRound ||
        !updates.some((update) => update.teamId === teamId && update.round === number))
    );
  }
}

import type { EventConfig } from './types';

/** Late arrivals may request access without changing any competing team's roster. */
export class SignupPolicy {
  static isOpen(event: EventConfig): boolean {
    return (
      !!event.platform &&
      !event.maintenance &&
      !event.activeOperationId &&
      ['DRAFT', 'REGISTRATION', 'SEED_OPEN', 'INTERMISSION', 'FROZEN'].includes(event.phase)
    );
  }
}

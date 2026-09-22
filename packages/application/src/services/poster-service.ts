import type { Member, PosterStatsPage } from '@robinhacks/core';
import type { Repository } from '../repository';
import { Permissions } from './permissions';

export interface PosterStore {
  recordVisit(number: number): Promise<void>;
  list(after: number): Promise<PosterStatsPage>;
}

/** Site-wide counters are visible only to the configured event's organizers. */
export class PosterService {
  constructor(
    private readonly members: Repository,
    private readonly posters: PosterStore,
    private readonly eventId: string,
  ) {}

  async stats(uid: string, after = 0): Promise<PosterStatsPage> {
    await this.members.transaction(async (tx) => {
      const member = await tx.get<Member>(`events/${this.eventId}/members/${uid}`);
      Permissions.member(member);
      Permissions.organizer(member);
    });
    return this.posters.list(after);
  }
}

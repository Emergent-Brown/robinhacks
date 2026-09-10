import { invariant, safeInteger } from './errors.js';
import { RULES } from './rules.js';
import { sha256 } from './sha256.js';

export type FundingRequests = Record<string, Record<string, number>>;

/** Largest-remainder allocation from one immutable snapshot, independent of submission order. */
export class FundingAllocator {
  static allocate(
    requests: FundingRequests,
    issuerIds: string[],
    tieSeed: string,
  ): FundingRequests {
    invariant(
      typeof tieSeed === 'string' && tieSeed.length > 0,
      'INVALID_SEED',
      'The published allocation seed is required.',
    );
    invariant(
      new Set(issuerIds).size === issuerIds.length,
      'INVALID_ISSUERS',
      'Issuer IDs must be unique.',
    );
    const teams = Object.keys(requests).sort();
    const result: FundingRequests = Object.fromEntries(
      teams.map((teamId) => [teamId, Object.create(null) as Record<string, number>]),
    );
    for (const teamId of teams) {
      let committed = 0n;
      for (const [issuerId, shares] of Object.entries(requests[teamId]!)) {
        safeInteger(shares, 'Funding shares');
        invariant(
          shares <= RULES.maxSeedRequestShares,
          'HOLDING_LIMIT',
          'A funding request exceeds the project share cap.',
        );
        invariant(
          issuerId !== teamId || shares === 0,
          'SELF_INVESTMENT',
          'A team cannot fund its own project.',
        );
        committed += BigInt(shares) * BigInt(RULES.primaryPriceMinor);
      }
      invariant(
        committed <= BigInt(RULES.maxSeedCommitmentMinor),
        'FUNDING_LIMIT',
        'Funding commitments exceed the team allowance.',
      );
    }
    for (const issuerId of [...issuerIds].sort()) {
      const entries = teams
        .map((teamId) => ({
          teamId,
          requested: Object.hasOwn(requests[teamId]!, issuerId) ? requests[teamId]![issuerId]! : 0,
          allocated: 0,
          remainder: 0n,
          tie: sha256(`${tieSeed}:${issuerId}:${teamId}`),
        }))
        .filter((entry) => entry.requested > 0);
      const total = entries.reduce((sum, entry) => sum + BigInt(entry.requested), 0n);
      const supply = BigInt(RULES.primaryShares);
      if (total <= supply) {
        for (const entry of entries) result[entry.teamId]![issuerId] = entry.requested;
        continue;
      }
      let allocated = 0;
      for (const entry of entries) {
        entry.allocated = Number((supply * BigInt(entry.requested)) / total);
        entry.remainder = (supply * BigInt(entry.requested)) % total;
        allocated += entry.allocated;
      }
      entries.sort((a, b) =>
        a.remainder !== b.remainder
          ? a.remainder > b.remainder
            ? -1
            : 1
          : a.tie !== b.tie
            ? a.tie < b.tie
              ? -1
              : 1
            : a.teamId < b.teamId
              ? -1
              : a.teamId > b.teamId
                ? 1
                : 0,
      );
      for (let i = 0; i < RULES.primaryShares - allocated; i++) entries[i]!.allocated++;
      for (const entry of entries)
        if (entry.allocated > 0) result[entry.teamId]![issuerId] = entry.allocated;
    }
    return result;
  }
  allocate(requests: FundingRequests, issuerIds: string[], tieSeed: string): FundingRequests {
    return FundingAllocator.allocate(requests, issuerIds, tieSeed);
  }
}

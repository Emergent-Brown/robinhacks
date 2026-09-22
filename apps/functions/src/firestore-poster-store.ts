import { FieldValue, type Firestore, type Timestamp } from 'firebase-admin/firestore';
import type { PosterStatsPage } from '@robinhacks/core';
import type { PosterStore } from '@robinhacks/application';

/** One atomic write per visit, with no visitor identities or per-visit documents. */
export class FirestorePosterStore implements PosterStore {
  constructor(private readonly db: Firestore) {}

  async recordVisit(number: number): Promise<void> {
    await this.db
      .collection('posterVisits')
      .doc(String(number))
      .set(
        {
          number,
          visits: FieldValue.increment(1),
          lastVisitedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  async list(after: number): Promise<PosterStatsPage> {
    const result = await this.db
      .collection('posterVisits')
      .orderBy('number')
      .startAfter(after)
      .limit(101)
      .get();
    const items = result.docs.slice(0, 100).map((doc) => {
      const data = doc.data();
      return {
        number: data.number as number,
        visits: data.visits as number,
        lastVisitedAt: (data.lastVisitedAt as Timestamp).toMillis(),
      };
    });
    return { items, nextCursor: result.size > 100 ? items.at(-1)!.number : null };
  }
}

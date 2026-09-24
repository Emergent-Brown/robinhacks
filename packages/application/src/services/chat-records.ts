import { sha256 } from '../../../core/src/sha256';

/** Commands are unique per actor; stored chat records must be unique across actors too. */
export const chatRecordId = (uid: string, commandId: string): string =>
  sha256(JSON.stringify([uid, commandId]));

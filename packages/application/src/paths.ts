import { identifier } from './command-schema';

/** The only place storage paths are constructed. Identity never comes from team input. */
export class EventPaths {
  readonly root: string;
  constructor(readonly eventId: string) {
    identifier.parse(eventId);
    this.root = `events/${eventId}`;
  }
  collection(name: string) {
    return `${this.root}/${name}`;
  }
  doc(collection: string, id: string) {
    identifier.parse(id);
    return `${this.collection(collection)}/${id}`;
  }
  member(uid: string) {
    return this.doc('members', uid);
  }
  team(id: string) {
    return this.doc('teams', id);
  }
}

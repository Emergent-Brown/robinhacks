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
  wallet(id: string) {
    return this.doc('wallets', id);
  }
  pool(id: string) {
    return this.doc('pools', id);
  }
  issuer(id: string) {
    return this.doc('issuers', id);
  }
  positions(id: string) {
    return `${this.wallet(id)}/positions`;
  }
  position(id: string, issuer: string) {
    identifier.parse(issuer);
    return `${this.positions(id)}/${issuer}`;
  }
  commitment(id: string) {
    return `${this.wallet(id)}/commitments/current`;
  }
  notes(id: string) {
    return `${this.wallet(id)}/notes`;
  }
  note(id: string, issuer: string) {
    identifier.parse(issuer);
    return `${this.notes(id)}/${issuer}`;
  }
  receipts(id: string) {
    return `${this.wallet(id)}/receipts`;
  }
  receipt(id: string, commandId: string) {
    identifier.parse(commandId);
    return `${this.receipts(id)}/${commandId}`;
  }
}

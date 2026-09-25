import type { Team } from '@robinhacks/core';

type RosterPerson = { teamId: string; name: string };
type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Browsing history stays on this device and is scoped to the event and account. */
export class ProjectVisits {
  private readonly memory = new Map<string, string[]>();

  constructor(private readonly storage: () => VisitStorage) {}

  read(key: string): string[] {
    let saved: string[] = [];
    try {
      const value: unknown = JSON.parse(this.storage().getItem(key) || '[]');
      if (Array.isArray(value)) saved = value.filter((id): id is string => typeof id === 'string');
    } catch {
      // Browsing still works when storage is blocked or a previous value is invalid.
    }
    return [...new Set([...saved, ...(this.memory.get(key) ?? [])])];
  }

  mark(key: string, id: string): void {
    const visited = [...new Set([...this.read(key), id])];
    this.memory.set(key, visited);
    try {
      this.storage().setItem(key, JSON.stringify(visited));
    } catch {
      // Keep visits in memory for the rest of this session when storage is unavailable.
    }
  }
}

export const projectVisits = new ProjectVisits(() => window.localStorage);

/** Discovery is a stable shuffle of unopened projects; investment totals never affect it. */
export function discoverProjects(
  projects: Team[],
  visited: string[],
  ownTeamId: string | null | undefined,
  seed: string,
): Team[] {
  const opened = new Set(visited);
  const hash = (id: string) =>
    [...(seed + id)].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return projects
    .filter(
      (team) => team.eligibility === 'active' && team.id !== ownTeamId && !opened.has(team.id),
    )
    .sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id))
    .slice(0, 3);
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export function projectSectors(projects: Pick<Team, 'category'>[]): string[] {
  const sectors = new Map<string, string>();
  for (const team of projects) {
    const sector = team.category.trim();
    if (sector && !sectors.has(normalize(sector))) sectors.set(normalize(sector), sector);
  }
  return [...sectors.values()].sort((a, b) => a.localeCompare(b));
}

/** Reuse an existing sector's spelling when someone types its name in the new-sector field. */
export function resolveProjectSector(value: string, projects: Pick<Team, 'category'>[]): string {
  return (
    projectSectors(projects).find((sector) => normalize(sector) === normalize(value)) ??
    value.trim()
  );
}

export function filterProjects(
  projects: Team[],
  roster: RosterPerson[],
  search: string,
  sector: string,
): Team[] {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  return projects.filter((team) => {
    if (sector && normalize(team.category) !== normalize(sector)) return false;
    const people = roster
      .filter((person) => person.teamId === team.id)
      .map((person) => person.name);
    const text = normalize(
      [team.name, team.pitch, team.problem, team.building, team.category, ...people].join(' '),
    );
    return words.every((word) => text.includes(word));
  });
}

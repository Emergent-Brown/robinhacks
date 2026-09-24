import { describe, expect, it } from 'vitest';
import type { Team } from '@robinhacks/core';
import {
  discoverProjects,
  filterProjects,
  projectSectors,
  ProjectVisits,
} from '../apps/web/src/platform/project-discovery';

function project(id: string, patch: Partial<Team> = {}): Team {
  return {
    id,
    name: id,
    ticker: id,
    pitch: '',
    category: '',
    color: '',
    problem: '',
    building: '',
    demoUrl: '',
    repoUrl: '',
    update: '',
    updatedAt: 0,
    eligibility: 'active',
    captainUid: '',
    version: 0,
    ...patch,
  };
}

describe('Project discovery', () => {
  const projects = Array.from({ length: 12 }, (_, index) => project(`team-${index}`));

  it('removes opened projects from the next group and never falls back to them', () => {
    const initial = discoverProjects(projects, [], 'team-0', 'alex:1:0');
    const visited = initial.map((team) => team.id);
    const next = discoverProjects(projects, visited, 'team-0', 'alex:1:0');
    expect(next).toHaveLength(3);
    expect(next.every((team) => !visited.includes(team.id) && team.id !== 'team-0')).toBe(true);
    expect(
      discoverProjects(
        projects,
        projects.map((team) => team.id),
        'team-0',
        'alex:1:0',
      ),
    ).toEqual([]);
  });

  it('varies groups when requested while keeping a given shuffle stable', () => {
    const first = discoverProjects(projects, [], 'team-0', 'alex:1:0');
    expect(discoverProjects([...projects].reverse(), [], 'team-0', 'alex:1:0')).toEqual(first);
    expect(discoverProjects(projects, [], 'team-0', 'alex:1:1')).not.toEqual(first);
  });

  it('excludes ineligible projects and does not reorder the supplied directory', () => {
    const source = [
      project('own'),
      project('withdrawn', { eligibility: 'withdrawn' }),
      project('active'),
    ];
    expect(discoverProjects(source, [], 'own', 'seed').map((team) => team.id)).toEqual(['active']);
    expect(source.map((team) => team.id)).toEqual(['own', 'withdrawn', 'active']);
  });
});

describe('Project browsing history', () => {
  it('persists only distinct visited IDs and separates accounts', () => {
    const values = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    const history = new ProjectVisits(storage);
    history.mark('event:alex', 'team-2');
    history.mark('event:alex', 'team-2');
    expect(new ProjectVisits(storage).read('event:alex')).toEqual(['team-2']);
    expect(history.read('event:sam')).toEqual([]);
  });

  it.each(['null', '{}', '"unexpected"', '{invalid', '[1,null,"team-2"]'])(
    'tolerates stored value %s',
    (value) => {
      const history = new ProjectVisits(() => ({ getItem: () => value, setItem: () => {} }));
      expect(() => history.mark('key', 'team-3')).not.toThrow();
      expect(history.read('key')).toContain('team-3');
      expect(history.read('key').every((id) => typeof id === 'string')).toBe(true);
    },
  );

  it('continues excluding visited projects when local storage access throws', () => {
    const history = new ProjectVisits(() => {
      throw new Error('Storage blocked');
    });
    history.mark('event:alex', 'team-2');
    expect(history.read('event:alex')).toEqual(['team-2']);
  });
});

describe('Project directory filters', () => {
  const projects = [
    project('mosaic', { name: 'Mosaic', pitch: 'Shared design boards', category: 'Design tools' }),
    project('canopy', { name: 'Canopy', pitch: 'Cooler cities', category: 'Climate' }),
  ];
  const roster = [
    { teamId: 'mosaic', name: 'Alex Rivera' },
    { teamId: 'canopy', name: 'José Chen' },
  ];

  it('finds a project by a teammate’s name, with accent and case tolerant matching', () => {
    expect(filterProjects(projects, roster, 'JOSE', '').map((team) => team.id)).toEqual(['canopy']);
    expect(filterProjects(projects, roster, '  alex   design ', '').map((team) => team.id)).toEqual(
      ['mosaic'],
    );
  });

  it('combines search with the selected sector', () => {
    expect(filterProjects(projects, roster, 'Alex', 'Climate')).toEqual([]);
    expect(filterProjects(projects, roster, '', ' climate ')).toEqual([projects[1]]);
    expect(filterProjects(projects, roster, 'climate', '')).toEqual([projects[1]]);
    expect(filterProjects(projects, roster, '', '')).toEqual(projects);
  });

  it('builds an alphabetical list without blank or duplicate sectors', () => {
    expect(
      projectSectors([...projects, project('other', { category: ' climate ' }), project('blank')]),
    ).toEqual(['Climate', 'Design tools']);
  });
});

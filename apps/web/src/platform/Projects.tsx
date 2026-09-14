import { useMemo, useState } from 'react';
import { ExternalLink, TeamMark } from '../ui/primitives';
import {
  Blank,
  config,
  navigate,
  Panel,
  platform,
  ProjectLink,
  stamp,
  teams,
  type PageProps,
} from './shared';

function visitedKey(data: PageProps['data']) {
  return `emergenthacks:visited:${data.event!.id}:${data.member?.uid}`;
}
function getVisited(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}
export function Projects({ data }: PageProps) {
  const [search, setSearch] = useState('');
  const [rotation, setRotation] = useState(0);
  const all = teams(data).filter((t) => t.eligibility === 'active');
  const visited = getVisited(visitedKey(data));
  const featured = useMemo(() => {
    const seed = `${data.member?.uid}:${config(data).currentRound}:${rotation}`;
    const hash = (value: string) =>
      [...(seed + value)].reduce((n, c) => ((n << 5) - n + c.charCodeAt(0)) | 0, 0) >>> 0;
    return all
      .filter((t) => t.id !== data.member?.teamId)
      .sort(
        (a, b) =>
          Number(visited.includes(a.id)) - Number(visited.includes(b.id)) ||
          hash(a.id) - hash(b.id),
      )
      .slice(0, 3);
  }, [all.map((t) => t.id).join('|'), rotation, data.member?.uid, config(data).currentRound]);
  const visible = all.filter((t) =>
    `${t.name} ${t.pitch} ${t.problem} ${t.building}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="p-page-heading">
        <h1>Projects</h1>
        <span className="muted">{all.length} teams</span>
      </div>
      {data.member?.teamId && featured.length > 0 && (
        <Panel
          title="Meet a few teams"
          aside={
            <button className="p-link" onClick={() => setRotation(rotation + 1)}>
              Show another group
            </button>
          }
        >
          <p className="muted">
            Start with projects you haven’t opened. Visit their demos or ask what they are working
            on.
          </p>
          <ul className="p-discovery">
            {featured.map((team) => (
              <li key={team.id}>
                <ProjectLink team={team} />
                <p>{team.pitch || 'Pitch coming soon.'}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="p-search">
        <label htmlFor="project-search">Search projects</label>
        <input
          id="project-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, pitch, or problem"
        />
      </div>
      <div className="p-table-wrap">
        <table className="p-table p-projects">
          <thead>
            <tr>
              <th>Project</th>
              <th>Latest update</th>
              <th>Team</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((team) => {
              const updates = platform(data)
                .updates.filter((item) => item.teamId === team.id)
                .sort((a, b) => b.createdAt - a.createdAt);
              const roster = platform(data).roster.filter((person) => person.teamId === team.id);
              return (
                <tr key={team.id}>
                  <td>
                    <div className="p-project-name">
                      <TeamMark team={team} />
                      <div>
                        <ProjectLink team={team} />
                        <p>{team.pitch || 'Pitch coming soon.'}</p>
                        <span className="p-mobile-only muted">
                          {updates[0]
                            ? `Updated ${stamp(updates[0].createdAt)}`
                            : 'No checkpoint update yet'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span>{updates[0] ? stamp(updates[0].createdAt) : 'Not published'}</span>
                  </td>
                  <td>
                    {roster.length
                      ? roster.map((person) => person.name).join(', ')
                      : 'Roster coming soon'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!visible.length && <Blank>No projects match your search.</Blank>}
    </>
  );
}

export function ProjectDetail({ data, id }: PageProps & { id: string }) {
  const team = teams(data).find((t) => t.id === id);
  if (!team)
    return (
      <Blank>
        Project not found.{' '}
        <button className="p-link" onClick={() => navigate('projects')}>
          View projects
        </button>
      </Blank>
    );
  const key = visitedKey(data);
  const visited = getVisited(key);
  if (!visited.includes(id))
    localStorage.setItem(key, JSON.stringify([...visited, id].slice(-100)));
  const updates = platform(data)
    .updates.filter((update) => update.teamId === id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const roster = platform(data).roster.filter((person) => person.teamId === id);
  return (
    <>
      <button className="p-link p-back" onClick={() => navigate('projects')}>
        ← All projects
      </button>
      <div className="p-page-heading">
        <div className="p-project-name">
          <TeamMark team={team} large />
          <div>
            <h1>{team.name}</h1>
            <p>{team.pitch}</p>
          </div>
        </div>
        {data.member?.teamId && data.member.teamId !== id && (
          <button className="button primary" onClick={() => navigate('messages', id)}>
            Message team
          </button>
        )}
      </div>
      <div className="p-two-column">
        <div>
          <Panel title="Problem">
            <p className="p-prose">
              {team.problem || 'The team has not added a problem statement.'}
            </p>
          </Panel>
          <Panel title="What they’re building">
            <p className="p-prose">{team.building || 'Project details are coming soon.'}</p>
            <div className="p-actions">
              <ExternalLink href={team.demoUrl}>Open demo</ExternalLink>
              <ExternalLink href={team.repoUrl}>Source code</ExternalLink>
            </div>
          </Panel>
        </div>
        <Panel title="Team">
          <ul className="p-roster">
            {roster.map((person) => (
              <li key={person.uid}>
                <strong>{person.name}</strong>
                <span>{person.role === 'trader' ? 'Designated investor' : person.role}</span>
              </li>
            ))}
          </ul>
          {!roster.length && <p>Roster coming soon.</p>}
          <p className="muted">
            {team.eligibility === 'active' ? 'Participating project' : team.eligibility}
          </p>
        </Panel>
      </div>
      <Panel title="Checkpoint updates">
        {!updates.length && <Blank>No checkpoint updates published yet.</Blank>}
        <ol className="p-updates">
          {updates.map((update) => (
            <li key={update.id}>
              <div className="p-section-heading">
                <h3>
                  {config(data).funding.roundNames[update.round - 1] || `Round ${update.round}`}
                </h3>
                <span className="muted">
                  {stamp(update.createdAt)} · {update.authorName}
                </span>
              </div>
              <dl className="p-update-content">
                <dt>What works</dt>
                <dd>{update.works}</dd>
                <dt>What changed</dt>
                <dd>{update.changed || 'No changes noted.'}</dd>
                <dt>Still incomplete</dt>
                <dd>{update.incomplete || 'Nothing noted.'}</dd>
              </dl>
              <ExternalLink href={update.evidenceUrl}>View evidence</ExternalLink>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

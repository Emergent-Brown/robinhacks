import { useState } from 'react';
import type { Team } from '@robinhacks/core';
import { Field } from '../ui/primitives';
import { projectSectors, resolveProjectSector } from './project-discovery';
import './sector-picker.css';

/** Native controls keep sector selection usable with a keyboard and on a phone. */
export function SectorPicker({
  projects,
  value,
  onChange,
  disabled = false,
}: {
  projects: Pick<Team, 'category'>[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const sectors = projectSectors(projects);
  const selected = sectors.indexOf(resolveProjectSector(value, projects));
  const selection = creating ? 'new' : !value ? '' : selected < 0 ? 'current' : String(selected);

  return (
    <div className="p-sector-picker">
      <Field label="Sector (optional)">
        <select
          value={selection}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setCreating(next === 'new');
            onChange(next === 'new' || next === '' ? '' : (sectors[Number(next)] ?? value));
          }}
        >
          <option value="">No sector</option>
          {sectors.map((sector, index) => (
            <option key={sector} value={String(index)}>
              {sector}
            </option>
          ))}
          {selection === 'current' && <option value="current">{value}</option>}
          <option value="new">Create a new sector…</option>
        </select>
      </Field>
      {creating && (
        <Field label="New sector name" hint="Once saved, other teams can choose this sector too.">
          <input
            autoFocus
            required
            pattern=".*\S.*"
            maxLength={40}
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => onChange(resolveProjectSector(value, projects))}
          />
        </Field>
      )}
    </div>
  );
}

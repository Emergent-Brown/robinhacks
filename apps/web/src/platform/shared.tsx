import { useState, type ReactNode } from 'react';
import type { AppSnapshot, Command, FundingSettings, Team } from '@robinhacks/core';
import { emptyPlatformSnapshot } from '@robinhacks/core';
import type { AppActions } from '../hooks/useApp';
import { newCommandId } from '../app/gateway';

export interface PageProps {
  data: AppSnapshot;
  actions: AppActions;
}
export type CommandInput = Command extends infer C
  ? C extends Command
    ? Omit<C, 'commandId'>
    : never
  : never;
export const platform = (data: AppSnapshot) => data.platform ?? emptyPlatformSnapshot();
export const config = (data: AppSnapshot) => data.event!.platform!;
export const teams = (data: AppSnapshot) => data.market.entries.map(({ team }) => team);
export const ownTeam = (data: AppSnapshot) => teams(data).find((t) => t.id === data.member?.teamId);
export const teamName = (data: AppSnapshot, id: string) =>
  teams(data).find((t) => t.id === id)?.name || 'Project';
export const canAllocate = (data: AppSnapshot) =>
  ['captain', 'trader'].includes(data.member?.role || '');
export const navigate = (page: string, id = '') => {
  location.hash = `/platform${page}${id ? `/${encodeURIComponent(id)}` : ''}`;
};
export const stamp = (time: number | null, zone?: string) =>
  time
    ? new Date(time).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        ...(zone ? { timeZone: zone, timeZoneName: 'short' } : {}),
      })
    : 'Not scheduled';
export const money = (minor: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(minor / 100);
export const percent = (fraction: number) =>
  `${(fraction * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
export function rewardCopy(settings: FundingSettings) {
  return settings.investorPoolMinor > 0
    ? `${money(settings.investorPoolMinor)} maximum investor rewards`
    : 'Investor cash prizes have not been announced';
}
export function useCommand(actions: AppActions) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function run(command: CommandInput | Command, success?: () => void) {
    setError('');
    setPending(true);
    try {
      await actions.execute({ ...command, commandId: newCommandId() } as Command);
      success?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved. Try again.');
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, error, pending, clearError: () => setError('') };
}
export function ErrorMessage({ children }: { children: ReactNode }) {
  return children ? (
    <p className="p-error" role="alert">
      {children}
    </p>
  ) : null;
}
export function Panel({
  title,
  children,
  aside,
}: {
  title?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="p-panel">
      {title && (
        <div className="p-section-heading">
          <h2>{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
export function ProjectLink({ team }: { team: Team }) {
  return (
    <button className="p-link" onClick={() => navigate('projects', team.id)}>
      {team.name}
    </button>
  );
}
export function Blank({ children }: { children: ReactNode }) {
  return <p className="p-empty">{children}</p>;
}
export function Amount({
  value,
  onChange,
  label,
  max,
  step,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  max: number;
  step: number;
  disabled: boolean;
}) {
  return (
    <div className="p-amount">
      <button
        aria-label={`Remove ${step} credits from ${label}`}
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - step))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={`Credits for ${label}`}
        min="0"
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <button
        aria-label={`Add ${step} credits to ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}

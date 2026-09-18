import { useState } from 'react';
import { EventSchedule, type PlannedWindow } from '@robinhacks/core';
import { Field } from '../ui/primitives';
import { stamp } from './shared';

export function WindowOpener({
  plan,
  zone,
  now,
  label,
  disabled,
  fallbackMinutes,
  maxMinutes,
  onOpen,
}: {
  plan: PlannedWindow | undefined;
  zone: string;
  now: number;
  label: string;
  disabled: boolean;
  fallbackMinutes: number;
  maxMinutes: number;
  onOpen: (window: { durationMinutes: number; closesAt: number }) => void;
}) {
  const [custom, setCustom] = useState(!plan);
  const [duration, setDuration] = useState(plan ? EventSchedule.minutes(plan) : fallbackMinutes);
  const unavailable = !custom && !!plan && (now < plan.startsAt || now >= plan.closesAt);
  return (
    <form
      className="p-window-opener"
      onSubmit={(event) => {
        event.preventDefault();
        if (unavailable || disabled) return;
        onOpen({
          durationMinutes: custom
            ? duration
            : Math.max(1, Math.ceil((plan!.closesAt - now) / 60_000)),
          closesAt: custom ? Date.now() + duration * 60_000 : plan!.closesAt,
        });
      }}
    >
      {plan && (
        <>
          <p>Planned: {EventSchedule.label(plan, zone)}</p>
          <Field label="Opening time">
            <select
              value={custom ? 'custom' : 'planned'}
              onChange={(event) => setCustom(event.target.value === 'custom')}
            >
              <option value="planned">Use planned deadline</option>
              <option value="custom">Open now for a custom duration</option>
            </select>
          </Field>
        </>
      )}
      {custom ? (
        <Field label="Duration (minutes)">
          <input
            type="number"
            min={1}
            max={maxMinutes}
            step={1}
            required
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
      ) : (
        <p className="muted">
          {now < plan!.startsAt
            ? `Available from ${stamp(plan!.startsAt, zone)}. Choose a custom duration to open earlier.`
            : now >= plan!.closesAt
              ? 'The planned deadline has passed. Edit the plan in Settings or choose a custom duration.'
              : 'Opening late keeps the planned deadline. Choose a custom duration to give teams more time.'}
        </p>
      )}
      <button className="button primary" disabled={disabled || unavailable}>
        {label}
      </button>
    </form>
  );
}

import { useEffect, useState } from 'react';
import {
  defaultEventDetails,
  EventSchedule,
  type EventDetails,
  type EventTiming,
  type PlannedWindow,
  type ScheduleWindow,
} from '@robinhacks/core';
import { Field } from '../ui/primitives';

const windowLabels: Array<[ScheduleWindow, string]> = [
  ['round1', 'Round 1'],
  ['round2', 'Round 2'],
  ['round3', 'Round 3'],
  ['submissions', 'Final submissions'],
  ['ballot', 'Community ballot'],
];

function TimeInput({
  label,
  value,
  zone,
  onChange,
}: {
  label: string;
  value: number;
  zone: string;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(EventSchedule.inputValue(value, zone));
  useEffect(() => setText(EventSchedule.inputValue(value, zone)), [value, zone]);
  return (
    <Field label={label}>
      <input
        type="datetime-local"
        required
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            const parsed = EventSchedule.parseInput(event.target.value, zone);
            event.target.setCustomValidity('');
            onChange(parsed);
          } catch (error) {
            event.target.setCustomValidity(
              error instanceof Error ? error.message : 'Enter a valid date and time.',
            );
          }
        }}
      />
    </Field>
  );
}

/** Keeps public rows linked to the same window plan used by the organizer controls. */
export function EventScheduleEditor({
  details,
  onChange,
}: {
  details: EventDetails;
  onChange: (details: EventDetails) => void;
}) {
  const changeSchedule = (schedule: EventDetails['schedule']) => onChange({ ...details, schedule });
  function move(index: number, delta: number) {
    const rows = [...details.schedule];
    [rows[index], rows[index + delta]] = [rows[index + delta], rows[index]];
    changeSchedule(rows);
  }
  function changeWindow(key: ScheduleWindow, value: PlannedWindow) {
    const timing = details.timing!;
    const next: EventTiming =
      key === 'submissions' || key === 'ballot'
        ? { ...timing, [key]: value }
        : {
            ...timing,
            rounds: timing.rounds.map((row, i) => (i === Number(key.slice(-1)) - 1 ? value : row)),
          };
    onChange({ ...details, timing: next });
  }
  let validZone = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: details.timeZone }).format();
  } catch {
    validZone = false;
  }
  return (
    <>
      <h3>Public schedule</h3>
      <p className="muted">
        Edit, reorder or remove any item. Linked times follow the window plan below.
      </p>
      {details.schedule.map((item, index) => (
        <div className="p-schedule-editor" key={index}>
          <div>
            <Field label="Time source">
              <select
                value={item.window || ''}
                onChange={(event) =>
                  changeSchedule(
                    details.schedule.map((old, i) => {
                      if (i !== index) return old;
                      const { window: ignored, ...manual } = old;
                      return event.target.value
                        ? { ...manual, window: event.target.value as ScheduleWindow }
                        : manual;
                    }),
                  )
                }
              >
                <option value="">Custom time label</option>
                {details.timing &&
                  windowLabels.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Time">
              <input
                maxLength={100}
                required={!item.window}
                readOnly={!!item.window}
                value={
                  item.window && details.timing && validZone
                    ? EventSchedule.label(
                        EventSchedule.resolve(details.timing, item.window)!,
                        details.timeZone,
                      )
                    : item.time
                }
                onChange={(event) =>
                  changeSchedule(
                    details.schedule.map((old, i) =>
                      i === index ? { ...old, time: event.target.value } : old,
                    ),
                  )
                }
              />
            </Field>
          </div>
          <Field label="Title">
            <input
              required
              maxLength={100}
              value={item.title}
              onChange={(event) =>
                changeSchedule(
                  details.schedule.map((old, i) =>
                    i === index ? { ...old, title: event.target.value } : old,
                  ),
                )
              }
            />
          </Field>
          <Field label="Description">
            <input
              maxLength={500}
              value={item.description}
              onChange={(event) =>
                changeSchedule(
                  details.schedule.map((old, i) =>
                    i === index ? { ...old, description: event.target.value } : old,
                  ),
                )
              }
            />
          </Field>
          <div className="p-schedule-actions">
            <button
              type="button"
              className="p-link"
              disabled={index === 0}
              aria-label={`Move ${item.title || 'item'} up`}
              onClick={() => move(index, -1)}
            >
              Up
            </button>
            <button
              type="button"
              className="p-link"
              disabled={index === details.schedule.length - 1}
              aria-label={`Move ${item.title || 'item'} down`}
              onClick={() => move(index, 1)}
            >
              Down
            </button>
            <button
              type="button"
              className="p-link"
              aria-label={`Remove ${item.title || 'item'}`}
              onClick={() => changeSchedule(details.schedule.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        disabled={details.schedule.length >= 20}
        onClick={() =>
          changeSchedule([...details.schedule, { time: '', title: '', description: '' }])
        }
      >
        Add schedule item
      </button>
      <h3>Planned windows</h3>
      <p className="muted">
        Times use the event time zone. Organizers still open and close windows in Event controls.
        Changing this plan updates linked public times and future opening defaults; it does not
        change a window already running. Pause/resume preserves time in a live window.
      </p>
      {!details.timing ? (
        <button
          type="button"
          className="button secondary"
          onClick={() => onChange({ ...details, timing: defaultEventDetails().timing })}
        >
          Add September 26–27 window plan
        </button>
      ) : !validZone ? (
        <p className="p-error">Enter a valid event time zone to edit the windows.</p>
      ) : (
        windowLabels.map(([key, label]) => {
          const value = EventSchedule.resolve(details.timing, key)!;
          return (
            <fieldset className="p-window-editor" key={key}>
              <legend>{label}</legend>
              <div className="p-form-grid">
                <TimeInput
                  label="Opens"
                  value={value.startsAt}
                  zone={details.timeZone}
                  onChange={(startsAt) => changeWindow(key, { ...value, startsAt })}
                />
                <TimeInput
                  label="Closes"
                  value={value.closesAt}
                  zone={details.timeZone}
                  onChange={(closesAt) => changeWindow(key, { ...value, closesAt })}
                />
              </div>
            </fieldset>
          );
        })
      )}
      <p className="muted">
        Finish submissions before round 3. Community voting follows round 3; leave time for scoring
        and the results review before announcing winners.
      </p>
    </>
  );
}

import { useState } from 'react';
import type { EventDetails, FundingSettings } from '@robinhacks/core';
import { Field } from '../ui/primitives';
import { config, ErrorMessage, Panel, useCommand, type PageProps } from './shared';

export function AdminSettings({ data, actions }: PageProps) {
  const current = config(data);
  const [name, setName] = useState(data.event!.name);
  const [venue, setVenue] = useState(data.event!.venue);
  const [details, setDetails] = useState<EventDetails>(current.details);
  const [funding, setFunding] = useState<FundingSettings>(current.funding);
  const cmd = useCommand(actions);
  const locked = !!current.rulesLockedAt;
  function detail<K extends keyof EventDetails>(key: K, value: EventDetails[K]) {
    setDetails({ ...details, [key]: value });
  }
  function financial<K extends keyof FundingSettings>(key: K, value: FundingSettings[K]) {
    setFunding({ ...funding, [key]: value });
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void cmd.run({ type: 'configurePlatform', name, venue, details, funding });
      }}
    >
      <Panel title="Public event information">
        <div className="p-form-grid">
          <Field label="Event name">
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Theme">
            <input
              required
              maxLength={80}
              value={details.theme}
              onChange={(event) => detail('theme', event.target.value)}
            />
          </Field>
        </div>
        <Field label="About">
          <textarea
            required
            maxLength={1500}
            rows={3}
            value={details.about}
            onChange={(event) => detail('about', event.target.value)}
          />
        </Field>
        <div className="p-form-grid">
          <Field label="Date (display text)">
            <input
              maxLength={100}
              value={details.dateLabel}
              placeholder="Not announced"
              onChange={(event) => detail('dateLabel', event.target.value)}
            />
          </Field>
          <Field label="Venue">
            <input
              maxLength={100}
              value={venue}
              placeholder="Not announced"
              onChange={(event) => setVenue(event.target.value)}
            />
          </Field>
          <Field label="Time zone">
            <input
              required
              maxLength={80}
              value={details.timeZone}
              onChange={(event) => detail('timeZone', event.target.value)}
            />
          </Field>
          <Field label="Eligibility">
            <input
              maxLength={500}
              value={details.eligibility}
              placeholder="Not announced"
              onChange={(event) => detail('eligibility', event.target.value)}
            />
          </Field>
          <Field label="Registration URL">
            <input
              type="url"
              maxLength={500}
              value={details.registrationUrl}
              onChange={(event) => detail('registrationUrl', event.target.value)}
            />
          </Field>
          <Field label="Contact email">
            <input
              type="email"
              maxLength={254}
              value={details.contactEmail}
              onChange={(event) => detail('contactEmail', event.target.value)}
            />
          </Field>
        </div>
        <h3>Schedule</h3>
        {details.schedule.map((item, index) => (
          <div className="p-schedule-editor" key={index}>
            <Field label="Time">
              <input
                maxLength={100}
                required
                value={item.time}
                onChange={(event) =>
                  detail(
                    'schedule',
                    details.schedule.map((old, i) =>
                      i === index ? { ...old, time: event.target.value } : old,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Title">
              <input
                maxLength={100}
                required
                value={item.title}
                onChange={(event) =>
                  detail(
                    'schedule',
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
                  detail(
                    'schedule',
                    details.schedule.map((old, i) =>
                      i === index ? { ...old, description: event.target.value } : old,
                    ),
                  )
                }
              />
            </Field>
            <button
              type="button"
              className="p-link"
              onClick={() =>
                detail(
                  'schedule',
                  details.schedule.filter((_, i) => i !== index),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={details.schedule.length >= 20}
          onClick={() =>
            detail('schedule', [...details.schedule, { time: '', title: '', description: '' }])
          }
        >
          Add schedule item
        </button>
      </Panel>
      <Panel title="Funding rules and prizes">
        {locked ? (
          <p className="p-note">
            These rules locked when the first round opened. Public event information remains
            editable.
          </p>
        ) : (
          <p>
            Confirm these settings before the first funding round. They become fixed for the event.
          </p>
        )}
        <fieldset disabled={locked}>
          <div className="p-form-grid">
            {(
              [
                ['budget', 'Credits per round'],
                ['increment', 'Allocation increment'],
                ['maxPerProject', 'Maximum per project'],
                ['minimumDenominator', 'Minimum funding denominator'],
                ['reviewMinutes', 'Results review (minutes)'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  required
                  min={key === 'reviewMinutes' ? 1 : 10}
                  step={1}
                  value={funding[key]}
                  onChange={(event) => financial(key, Number(event.target.value))}
                />
              </Field>
            ))}
          </div>
          <h3>Round weights</h3>
          {funding.roundNames.map((round, index) => (
            <div className="p-form-grid" key={index}>
              <Field label={`Round ${index + 1} name`}>
                <input
                  required
                  maxLength={60}
                  value={round}
                  onChange={(event) =>
                    financial(
                      'roundNames',
                      funding.roundNames.map((old, i) => (i === index ? event.target.value : old)),
                    )
                  }
                />
              </Field>
              <Field label="Reward weight (%)">
                <input
                  type="number"
                  required
                  min="1"
                  max="100"
                  step="0.01"
                  value={funding.roundWeightsBps[index]! / 100}
                  onChange={(event) =>
                    financial(
                      'roundWeightsBps',
                      funding.roundWeightsBps.map((old, i) =>
                        i === index ? Math.round(Number(event.target.value) * 100) : old,
                      ),
                    )
                  }
                />
              </Field>
            </div>
          ))}
          <p className="muted">Weights must total 100%.</p>
          <div className="p-form-grid">
            <Field label="Maximum investor reward pool (USD)">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={funding.investorPoolMinor / 100}
                onChange={(event) =>
                  financial('investorPoolMinor', Math.round(Number(event.target.value) * 100))
                }
              />
            </Field>
            <Field label="Community prize (USD)">
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={funding.communityPrizeMinor / 100}
                onChange={(event) =>
                  financial('communityPrizeMinor', Math.round(Number(event.target.value) * 100))
                }
              />
            </Field>
            {funding.builderPrizesMinor.map((prize, index) => (
              <Field key={index} label={`Builder place ${index + 1} (USD)`}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={prize / 100}
                  onChange={(event) =>
                    financial(
                      'builderPrizesMinor',
                      funding.builderPrizesMinor.map((old, i) =>
                        i === index ? Math.round(Number(event.target.value) * 100) : old,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </div>
          <p className="muted">
            Use 0 for prizes that have not been funded or announced. Credits never become spendable
            cash.
          </p>
          <Field label="Unallocated reward reserve policy">
            <textarea
              required
              maxLength={500}
              value={funding.reservePolicy}
              onChange={(event) => financial('reservePolicy', event.target.value)}
            />
          </Field>
          <h3>Judging rubric</h3>
          {funding.rubric.map((criterion, index) => (
            <div className="p-form-grid" key={criterion.id}>
              <Field label={`Criterion ${index + 1}`}>
                <input
                  required
                  maxLength={80}
                  value={criterion.label}
                  onChange={(event) =>
                    financial(
                      'rubric',
                      funding.rubric.map((old, i) =>
                        i === index ? { ...old, label: event.target.value } : old,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Weight (%)">
                <input
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={criterion.weight}
                  onChange={(event) =>
                    financial(
                      'rubric',
                      funding.rubric.map((old, i) =>
                        i === index ? { ...old, weight: Number(event.target.value) } : old,
                      ),
                    )
                  }
                />
              </Field>
            </div>
          ))}
          <p className="muted">
            Scores use a whole-number 0–10 scale. Rubric weights must total 100%.
          </p>
        </fieldset>
      </Panel>
      <ErrorMessage>{cmd.error}</ErrorMessage>
      <button className="button primary" disabled={cmd.pending}>
        Save event settings
      </button>
    </form>
  );
}

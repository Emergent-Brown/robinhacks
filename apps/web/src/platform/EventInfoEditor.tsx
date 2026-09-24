import type { EventDetails } from '@robinhacks/core';
import { Field } from '../ui/primitives';

const logisticsFields = [
  ['gettingThere', 'Getting there', 1000],
  ['meals', 'Meals', 500],
  ['overnight', 'Overnight building', 1000],
  ['bring', 'What to bring', 500],
] as const;

/** Public copy is event data, so organizers can update it without a code deployment. */
export function EventInfoEditor({
  details,
  onChange,
}: {
  details: EventDetails;
  onChange: (details: EventDetails) => void;
}) {
  const logistics = details.logistics || { gettingThere: '', meals: '', overnight: '', bring: '' };
  const organization = details.organization || { about: '', url: '' };
  return (
    <>
      <h3>Attendee logistics</h3>
      <p className="muted">
        Shown on the homepage. Keep addresses, meals, and overnight plans current.
      </p>
      <div className="p-form-grid">
        {logisticsFields.map(([key, label, maxLength]) => (
          <Field key={key} label={label}>
            <textarea
              rows={3}
              maxLength={maxLength}
              value={logistics[key]}
              onChange={(event) =>
                onChange({ ...details, logistics: { ...logistics, [key]: event.target.value } })
              }
            />
          </Field>
        ))}
      </div>
      <h3>Who are we?</h3>
      <Field label="About the organizers">
        <textarea
          rows={3}
          maxLength={1000}
          value={organization.about}
          onChange={(event) =>
            onChange({ ...details, organization: { ...organization, about: event.target.value } })
          }
        />
      </Field>
      <Field label="Organization website">
        <input
          type="url"
          maxLength={500}
          value={organization.url}
          placeholder="https://"
          onChange={(event) =>
            onChange({ ...details, organization: { ...organization, url: event.target.value } })
          }
        />
      </Field>
    </>
  );
}

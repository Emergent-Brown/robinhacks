import { useId } from 'react';
import { MAX_PROJECT_LINKS, type ProjectLink } from '@robinhacks/core';
import { ExternalLink, Field } from '../ui/primitives';
import './project-links.css';

export function ProjectLinks({ links = [] }: { links?: ProjectLink[] }) {
  return (
    <>
      {links.map((link, index) => (
        <ExternalLink key={`${index}-${link.url}`} href={link.url}>
          {link.label}
        </ExternalLink>
      ))}
    </>
  );
}

/** Shared by participant profiles and organizer profile/evidence editors. */
export function ProjectLinksEditor({
  links,
  onChange,
  disabled = false,
}: {
  links: ProjectLink[];
  onChange: (links: ProjectLink[]) => void;
  disabled?: boolean;
}) {
  const suggestions = useId();
  function update(index: number, patch: Partial<ProjectLink>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }
  return (
    <fieldset className="p-project-links" disabled={disabled}>
      <legend>Additional links (optional)</legend>
      <p className="muted">
        Add a demo video, website, GitHub repository, slide deck, or other resource. Up to{' '}
        {MAX_PROJECT_LINKS} links.
      </p>
      <datalist id={suggestions}>
        {['Demo video', 'Website', 'GitHub', 'Slide deck', 'Documentation'].map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      {links.map((link, index) => (
        <div className="p-project-link-row" key={index}>
          <Field label={`Link ${index + 1} label`}>
            <input
              required
              maxLength={40}
              list={suggestions}
              value={link.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
          </Field>
          <Field label={`Link ${index + 1} URL`}>
            <input
              required
              type="url"
              pattern="[hH][tT][tT][pP][sS]?://.*"
              maxLength={500}
              placeholder="https://"
              value={link.url}
              onChange={(event) => update(index, { url: event.target.value })}
            />
          </Field>
          <button
            className="button secondary"
            type="button"
            aria-label={`Remove link ${index + 1}`}
            onClick={() => onChange(links.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="button secondary"
        type="button"
        disabled={links.length >= MAX_PROJECT_LINKS}
        onClick={() => onChange([...links, { label: '', url: '' }])}
      >
        Add link
      </button>
    </fieldset>
  );
}

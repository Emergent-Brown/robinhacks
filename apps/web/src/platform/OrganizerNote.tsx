import { useState } from 'react';
import { Dialog, Field } from '../ui/primitives';
import { ErrorMessage, Panel, stamp, useCommand, type PageProps } from './shared';
import './organizer-note.css';

/** A versioned draft prevents one organizer from silently replacing another's note. */
function NoteForm({ data, actions, onSaved }: PageProps & { onSaved?: () => void }) {
  const event = data.event!;
  const currentVersion = event.announcementVersion ?? 0;
  const [draft, setDraft] = useState(event.announcement ?? '');
  const [version, setVersion] = useState(currentVersion);
  const { run, pending, error, clearError } = useCommand(actions);
  const stale = version !== currentVersion;
  const changed = draft.trim() !== (event.announcement ?? '');
  async function save(announcement: string) {
    await run({ type: 'setAnnouncement', announcement, expectedVersion: version }, () => {
      setDraft(announcement);
      setVersion(version + 1);
      onSaved?.();
    });
  }
  return (
    <form
      className="p-note-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft.trim());
      }}
    >
      <p className="p-muted">
        A short notice above every approved participant’s page. Use #general for a conversation.
      </p>
      {event.announcement && (
        <div className="p-note-current">
          <span className="p-eyebrow">Currently posted</span>
          <p>{event.announcement}</p>
          {event.announcementUpdatedAt && (
            <small>
              {event.announcementAuthor || 'Organizer'} ·{' '}
              {stamp(event.announcementUpdatedAt, event.platform?.details.timeZone)}
            </small>
          )}
        </div>
      )}
      <Field label="Note" hint={`${draft.length}/500 characters`}>
        <textarea
          rows={3}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pitches start at 11. Please have your demo ready."
        />
      </Field>
      {stale && (
        <div className="p-note-conflict" role="status">
          <p>This note changed while you were editing. Load the latest version before posting.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setDraft(event.announcement ?? '');
              setVersion(currentVersion);
              clearError();
            }}
          >
            Load current note
          </button>
        </div>
      )}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="p-button-row">
        <button
          className="button"
          disabled={pending || actions.busy || stale || !changed || !draft.trim()}
        >
          {pending ? 'Saving…' : event.announcement ? 'Update note' : 'Post note'}
        </button>
        {event.announcement && (
          <button
            type="button"
            className="button secondary"
            disabled={pending || actions.busy || stale}
            onClick={() => void save('')}
          >
            Remove note
          </button>
        )}
      </div>
    </form>
  );
}

export function OrganizerNoteEditor(props: PageProps) {
  return (
    <Panel title="Organizer note">
      <NoteForm {...props} />
    </Panel>
  );
}

export function OrganizerNoteDialog({ onClose, ...props }: PageProps & { onClose: () => void }) {
  return (
    <Dialog title="Organizer note" onClose={onClose}>
      <NoteForm {...props} onSaved={onClose} />
    </Dialog>
  );
}

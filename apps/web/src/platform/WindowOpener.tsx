import { EventSchedule, type PlannedWindow } from '@robinhacks/core';

/** Plans are organizer guidance; opening never starts an automatic timer. */
export function WindowOpener({
  plan,
  zone,
  label,
  disabled,
  onOpen,
}: {
  plan: PlannedWindow | undefined;
  zone: string;
  label: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="p-window-opener">
      {plan && (
        <p className="muted">
          Suggested: {EventSchedule.label(plan, zone)}. You can open and close this at any time.
        </p>
      )}
      <button type="button" className="button primary" disabled={disabled} onClick={onOpen}>
        {label}
      </button>
    </div>
  );
}

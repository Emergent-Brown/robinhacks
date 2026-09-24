import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, X } from 'lucide-react';
import type { Team } from '@robinhacks/core';

export function TeamMark({
  team,
  large = false,
}: {
  team: Pick<Team, 'color' | 'ticker' | 'name'>;
  large?: boolean;
}) {
  return (
    <span
      className={`team-mark ${large ? 'large' : ''}`}
      style={{ background: team.color || '#d4e6f1', color: markTextColor(team.color) }}
      aria-hidden="true"
    >
      {(team.ticker || team.name).slice(0, 2)}
    </span>
  );
}
function markTextColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#000';
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 < 0.179
    ? '#fff'
    : '#000';
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//i.test(href)) return null;
  return (
    <a className="text-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={16} />
    </a>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = ref.current!;
    const controls = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
        ),
      );
    (controls()[0] || node).focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const elements = controls();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', key);
      old?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

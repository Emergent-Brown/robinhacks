import { EventSchedule } from '@robinhacks/core';
import { ExternalLink } from '../ui/primitives';
import { JudgingRubric } from './JudgingRubric';
import { config, navigate, Panel, type PageProps } from './shared';
import './homepage.css';

function jumpTo(id: string) {
  const section = document.getElementById(id);
  section?.focus({ preventScroll: true });
  section?.scrollIntoView({ behavior: 'auto', block: 'start' });
}

export function Homepage({ data, onJoin }: PageProps & { onJoin: () => void }) {
  const { details, funding } = config(data);
  const logistics = details.logistics;
  const organization = details.organization;
  const sections = [
    ...(logistics ? [['home-logistics', 'Logistics']] : []),
    ['home-schedule', 'Schedule'],
    ['home-rubric', 'Judging rubric'],
    ...(organization ? [['home-organizers', 'Who are we?']] : []),
  ];
  return (
    <div className="p-home">
      <div className="p-page-heading">
        <div>
          <p className="p-kicker">{details.theme}</p>
          <h1>{data.event!.name}</h1>
        </div>
        <div className="p-actions">
          <button className="p-link" onClick={() => navigate('rules')}>
            Event rules
          </button>
          {details.registrationUrl ? (
            <a
              className="button primary"
              href={details.registrationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Join the event <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <button className="button primary" onClick={onJoin}>
              Join the event
            </button>
          )}
        </div>
      </div>
      <nav className="p-home-jumps" aria-label="On this page">
        {sections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jumpTo(id!)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="p-home-columns">
        <Panel title="About the event">
          <p className="p-prose">{details.about}</p>
          <dl className="p-facts">
            <dt>When</dt>
            <dd>{details.dateLabel || 'Date to be announced'}</dd>
            <dt>Where</dt>
            <dd>{data.event!.venue || 'Venue to be announced'}</dd>
          </dl>
          {details.contactEmail && (
            <p>
              Questions? <a href={`mailto:${details.contactEmail}`}>{details.contactEmail}</a>
            </p>
          )}
        </Panel>
        <Panel title="During the hackathon">
          <ol className="p-steps">
            <li>
              <strong>Build a project.</strong> Keep a public page with the problem, demo, and team.
            </li>
            <li>
              <strong>Meet the other teams.</strong> Read their updates, visit demos, and ask
              questions.
            </li>
            <li>
              <strong>Invest in three rounds.</strong> Allocate a fresh credit budget privately
              before each deadline.
            </li>
            <li>
              <strong>Finish and submit.</strong> Judges evaluate the work independently of funding.
            </li>
          </ol>
        </Panel>
      </div>
      {logistics && (
        <section id="home-logistics" tabIndex={-1} aria-labelledby="home-logistics-title">
          <Panel>
            <h2 id="home-logistics-title">Logistics</h2>
            <div className="p-logistics-grid">
              <div>
                <h3>Getting there</h3>
                <p>{logistics.gettingThere}</p>
              </div>
              <div>
                <h3>Meals</h3>
                <p>{logistics.meals}</p>
              </div>
              <div>
                <h3>It’s an overnight build</h3>
                <p>{logistics.overnight}</p>
              </div>
              <div>
                <h3>What to bring</h3>
                <p>{logistics.bring}</p>
                <p>
                  <button className="p-link" onClick={onJoin}>
                    Open your dashboard
                  </button>{' '}
                  to manage your team’s project page and investments. Sign in with Google to check
                  your access.
                </p>
              </div>
            </div>
          </Panel>
        </section>
      )}
      <section id="home-schedule" tabIndex={-1} aria-labelledby="home-schedule-title">
        <Panel>
          <div className="p-section-heading">
            <h2 id="home-schedule-title">Schedule</h2>
            <span className="muted">
              {details.timeZone === 'America/New_York'
                ? 'Eastern time'
                : details.timeZone.replaceAll('_', ' ')}
            </span>
          </div>
          {details.schedule.length ? (
            <ol className="p-schedule">
              {details.schedule.map((item, index) => {
                const planned = EventSchedule.resolve(details.timing, item.window);
                return (
                  <li
                    key={index}
                    className={item.window?.startsWith('round') ? 'p-schedule-round' : undefined}
                  >
                    <time>
                      {planned ? EventSchedule.label(planned, details.timeZone) : item.time}
                    </time>
                    <div>
                      <strong>{item.title}</strong>
                      {item.description && <p>{item.description}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p>The organizer will publish the schedule here.</p>
          )}
          <p className="muted">Schedule subject to change.</p>
        </Panel>
      </section>
      <div className="p-home-columns">
        <section id="home-rubric" tabIndex={-1} aria-labelledby="home-rubric-title">
          <Panel>
            <h2 id="home-rubric-title">Emergent Hacks rubric</h2>
            <JudgingRubric funding={funding} />
          </Panel>
        </section>
        {organization && (
          <section id="home-organizers" tabIndex={-1} aria-labelledby="home-organizers-title">
            <Panel>
              <h2 id="home-organizers-title">Who are we?</h2>
              <p className="p-prose">{organization.about}</p>
              {organization.url && (
                <ExternalLink href={organization.url}>Meet Emergent</ExternalLink>
              )}
            </Panel>
          </section>
        )}
      </div>
    </div>
  );
}

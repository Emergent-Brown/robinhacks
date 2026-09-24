import { useState } from 'react';
import { EventSchedule } from '@robinhacks/core';
import { Dialog, ExternalLink } from '../ui/primitives';
import { JudgingRubric } from './JudgingRubric';
import { config, navigate, Panel, type PageProps } from './shared';
import './homepage.css';

export function Homepage({ data, onJoin }: PageProps & { onJoin: () => void }) {
  const [rubricOpen, setRubricOpen] = useState(false);
  const { details, funding } = config(data);
  const logistics = details.logistics;
  const organization = details.organization;
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
          {organization && (
            <div className="p-home-organization">
              <h3>Who are we?</h3>
              <p className="p-prose">{organization.about}</p>
              {organization.url && (
                <ExternalLink href={organization.url}>Meet Emergent</ExternalLink>
              )}
            </div>
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
              <strong>Finish and submit.</strong> Judges evaluate the work independently of funding.{' '}
              <button className="p-link" aria-haspopup="dialog" onClick={() => setRubricOpen(true)}>
                View the judging rubric
              </button>
              .
            </li>
          </ol>
        </Panel>
      </div>
      {logistics && (
        <section aria-labelledby="home-logistics-title">
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
      <section aria-labelledby="home-schedule-title">
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
      {rubricOpen && (
        <Dialog title="Emergent Hacks rubric" onClose={() => setRubricOpen(false)}>
          <JudgingRubric funding={funding} />
        </Dialog>
      )}
    </div>
  );
}

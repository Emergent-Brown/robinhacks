// These are real UI interactions. They never write wallets or bypass game commands.
export const helpers = String.raw`
  const wait = ms => page.waitForTimeout(ms);
  const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
  async function click(locator, hold = 450) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    let outline;
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
      outline = await page.screencast.showOverlay('<div style="position:absolute;left:' + (box.x-5) + 'px;top:' + (box.y-5) + 'px;width:' + (box.width+10) + 'px;height:' + (box.height+10) + 'px;border:2px solid #4657e8;border-radius:12px;box-shadow:0 0 0 4px #4657e81b;pointer-events:none"></div>');
      await wait(280);
    }
    await locator.click();
    await wait(hold);
    if (outline) await outline.dispose();
  }
  async function nav(name, mobile = false) {
    await click(page.getByRole('navigation', { name: mobile ? 'Mobile navigation' : 'Main navigation', exact: true }).getByRole('button', { name, exact: true }));
  }
  async function role(name) {
    await click(button('Demo'), 220);
    await click(page.getByRole('dialog').getByRole('button', { name: new RegExp('^' + name) }), 550);
  }
  async function project(name, mobile = false) {
    await nav('Projects', mobile);
    await page.getByRole('searchbox', { name: 'Search projects' }).pressSequentially(name, { delay: 60 });
    await wait(280);
    await click(page.getByRole('button', { name, exact: true }));
  }
  async function phase(label, minutes) {
    await click(button(label), 250);
    const review = page.getByRole('dialog');
    if (minutes) await review.getByLabel('Window duration in minutes', { exact: true }).fill(String(minutes));
    await wait(650);
    await click(review.getByRole('button', { name: 'Confirm change', exact: true }), 650);
  }
`;

export const actions = {
  '01-explore': String.raw`
    await nav('Projects');
    await wait(3200);
    await page.mouse.wheel(0, 450);
    await wait(3000);
    await page.mouse.wheel(0, -450);
  `,
  '02-projects': String.raw`
    await project('Halide');
    await wait(4300);
    await page.getByRole('heading', { name: 'Latest checkpoint', exact: true }).scrollIntoViewIfNeeded();
    await wait(3000);
    await page.mouse.wheel(0, -600);
  `,
  '03-seed-request': String.raw`
    await click(button('Set seed commitment'));
    await page.getByLabel('Shares requested').fill('20');
    await wait(5200);
    await click(button('Save commitment'), 900);
  `,
  '04-sealed-sheet': String.raw`
    await nav('Portfolio');
    await wait(3800);
    await click(button('Edit Halide commitment'));
    await wait(2800);
    await click(button('Close dialog'));
  `,
  '05-close-seed': String.raw`
    await role('Organizer');
    await phase('Close seed & allocate');
    await wait(1300);
    await click(button('Continue settlement'), 1000);
    await page.getByRole('heading', { name: 'Build time', exact: true }).waitFor();
    await wait(1600);
  `,
  '06-seed-holdings': String.raw`
    await role('Team captain');
    await nav('Portfolio');
    await wait(3500);
    await click(page.getByRole('tab', { name: 'Activity', exact: true }));
    await wait(2300);
    await click(page.getByRole('tab', { name: /^Holdings/ }));
  `,
  '07-open-trading': String.raw`
    await role('Organizer');
    await phase('Open trading window', 30);
    await wait(2200);
  `,
  '08-buy': String.raw`
    await role('Team captain');
    await project('Halide');
    await click(button('Buy shares'));
    await page.getByLabel('Shares').fill('3');
    await wait(2800);
    await click(button('Confirm buy'), 850);
    await page.getByRole('heading', { name: 'Trade confirmed', exact: true }).waitFor();
  `,
  '09-sell': String.raw`
    await click(button('Done'));
    await wait(2600);
    await click(button('Sell shares'));
    await page.getByLabel('Shares').fill('1');
    await wait(3000);
    await click(button('Confirm sale'), 750);
    await page.getByRole('heading', { name: 'Trade confirmed', exact: true }).waitFor();
    await wait(1200);
    await click(button('Done'));
  `,
  '10-investment-note': String.raw`
    await nav('Portfolio');
    await click(page.getByRole('tab', { name: 'Investment notes', exact: true }));
    await page.getByRole('combobox', { name: 'Add a project note', exact: true }).selectOption('team-3');
    await page.getByLabel('Reason to invest', { exact: true }).pressSequentially('Marcus caught a destructive migration before merge. The rollback preview is clear and useful.', { delay: 14 });
    await page.getByLabel('Reconsider if', { exact: true }).fill('A failed backfill leaves the database in an unclear state.');
    await page.getByLabel('Next review', { exact: true }).fill('Ask Marcus to run the failing-backfill demo at 4 PM.');
    await wait(1700);
    await click(button('Save team note'), 900);
  `,
  '11-teammate': String.raw`
    await role('Team member');
    await nav('Portfolio');
    await wait(1600);
    await click(page.getByRole('tab', { name: 'Investment notes', exact: true }));
    await wait(1700);
    await nav('My team');
    await page.getByRole('heading', { name: 'Team members', exact: true }).scrollIntoViewIfNeeded();
    await wait(2200);
  `,
  '12-mobile': String.raw`
    await role('Team captain');
    await wait(1400);
    await project('Nimbus', true);
    await wait(2600);
    await page.mouse.wheel(0, 440);
    await wait(2300);
    await nav('Portfolio', true);
  `,
  '13-pause': String.raw`
    await role('Organizer');
    await page.getByLabel('Pause message', { exact: true }).fill('Checkpoint demos are starting. Back in two minutes.');
    await click(button('Pause now'));
    await page.getByLabel('Announcement').fill('Checkpoint demos at the main stage. Visit Halide and Nimbus after the break.');
    await click(button('Publish announcement'));
    await wait(2400);
    await click(button('Resume event'), 1000);
  `,
  '14-freeze': String.raw`
    await phase('Close trading window');
    await phase('End trading & start judging');
    await click(button('Enter judging scores'));
    const scores = { Mosaic:82, Nimbus:88, Halide:94, Kettle:79, Orbit:84, Sunbelt:75, Patch:90, Relay:86, Common:81, Folio:77, Current:88, Loom:92 };
    for (const [name, score] of Object.entries(scores)) {
      await page.getByRole('spinbutton', { name: 'Score for ' + name, exact: true }).fill(String(score));
      await wait(75);
    }
  `,
  '15-preview-results': String.raw`
    await click(button('Preview final share values'));
    await wait(4200);
    await page.getByRole('dialog').getByRole('button', { name: 'Lock scores & settle', exact: true }).scrollIntoViewIfNeeded();
    await wait(3800);
  `,
  '16-publish': String.raw`
    await click(button('Lock scores & settle'), 700);
    await click(button('Continue settlement'), 1000);
    await button('Review & publish results').waitFor();
    await wait(1100);
    await click(button('Review & publish results'), 650);
    await wait(1300);
    await click(button('Publish final results'), 1000);
  `,
  '17-standings': String.raw`
    await role('Team captain');
    await nav('Standings');
    await wait(2600);
    await click(page.getByRole('tab', { name: 'Investing teams', exact: true }));
    await wait(3200);
    await click(page.getByRole('tab', { name: 'Judged projects', exact: true }));
    await wait(2200);
  `,
};

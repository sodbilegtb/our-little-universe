import { expect, hostAction, joinAs, test } from './fixtures';

test('phones and the TV ride out a dropped connection and catch up', async ({ evening }, testInfo) => {
  test.skip(testInfo.project.name !== 'mock', 'The connection drop is simulated by the mock only.');
  const { tv, admin, phone } = evening;
  await joinAs(phone, 'Theo');

  await admin.getByRole('button', { name: 'Simulate connection drop' }).click();
  await expect(phone.getByText('Reconnecting…')).toBeVisible({ timeout: 8_000 });
  await expect(tv.getByText('Reconnecting…')).toBeVisible({ timeout: 8_000 });

  // The host moves on while the party devices are offline.
  await hostAction(admin, 'Start voting', 'Start voting');

  // Once the connection is back, everyone lands in the current phase.
  await expect(phone.getByRole('heading', { name: "What's your guess?" })).toBeVisible({ timeout: 30_000 });
  await expect(tv.getByRole('heading', { name: "What's your guess?" })).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByText('Reconnecting…')).toBeHidden();
});

test('late guests join the current phase, and a refreshed TV returns to the same scene', async ({ evening }) => {
  const { tv, admin, newPhone } = evening;
  await hostAction(admin, 'Start voting', 'Start voting');
  await hostAction(admin, 'Close voting', 'Close voting');
  await hostAction(admin, 'Start the quiz', 'Start the quiz');
  await hostAction(admin, 'Open question 1');

  const late = await newPhone(2);
  await joinAs(late, 'Late Lea').catch(() => undefined); // the waiting screen may be skipped
  await expect(late.getByRole('heading', { name: 'Who is better at cooking?' })).toBeVisible();

  await tv.reload();
  await expect(tv.getByRole('heading', { name: 'Who is better at cooking?' })).toBeVisible();
});

test('a question closes on its own when its time runs out', async ({ evening }) => {
  const { tv, admin, phone } = evening;
  await joinAs(phone, 'Ben');
  // Shorten question 1 to 10 seconds through the quiz editor.
  await admin.getByRole('button', { name: /Who is better at cooking\?/ }).click();
  await admin.getByRole('radio', { name: '10s' }).click();
  await admin.getByRole('button', { name: 'Save quiz' }).click();
  await expect(admin.getByText('Saved', { exact: true })).toBeVisible();

  await hostAction(admin, 'Start voting', 'Start voting');
  await hostAction(admin, 'Close voting', 'Close voting');
  await hostAction(admin, 'Start the quiz', 'Start the quiz');
  await hostAction(admin, 'Open question 1');
  await expect(phone.getByRole('heading', { name: 'Who is better at cooking?' })).toBeVisible();

  // No host action: after 10s plus grace the question is closed for everyone.
  await expect(admin.getByRole('button', { name: 'Reveal the answer' })).toBeVisible({ timeout: 20_000 });
  await expect(phone.getByText(/No answer this round/)).toBeVisible();
  await expect(tv.getByText('Time’s up')).toBeVisible();
});

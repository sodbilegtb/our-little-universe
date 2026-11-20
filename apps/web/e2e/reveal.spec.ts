import { expect, hostAction, joinAs, playThroughQuiz, test } from './fixtures';

test('the TV plays the reveal on the server clock, asks for the result only at the reveal moment, and survives a refresh', async ({
  evening,
}, testInfo) => {
  test.setTimeout(150_000);
  const { tv, admin, phone } = evening;

  // Every request for the result, with the moment it was made.
  const resultRequests: number[] = [];
  tv.on('request', (request) => {
    if (request.url().includes('/v1/reveal/result')) resultRequests.push(Date.now());
  });

  await joinAs(phone, 'Mia');
  await admin.getByRole('button', { name: 'Simulate the doctor (test)' }).click();
  const code = (await admin.getByTestId('test-code').textContent())!.trim();
  await hostAction(admin, 'Start voting', 'Start voting');
  await hostAction(admin, 'Close voting', 'Close voting');
  await hostAction(admin, 'Start the quiz', 'Start the quiz');
  await hostAction(admin, 'Open question 1');
  await playThroughQuiz(admin);
  await hostAction(admin, 'Start messages for baby', 'Start messages');
  await hostAction(admin, 'Start the reveal', 'Start the reveal');
  await expect(tv.getByRole('heading', { name: 'THE FINAL SECRET' })).toBeVisible();

  await admin.getByLabel('Reveal code').fill(code);
  await admin.getByRole('button', { name: 'Unlock the reveal' }).click();
  await expect(admin.getByText('The code was accepted. The reveal is on the TV now.')).toBeVisible();
  const unlockedAt = Date.now();

  // The sequence starts by decoding the (now spent) code, and builds up with no result anywhere yet.
  const sequence = tv.getByTestId('reveal-sequence');
  await expect(sequence).toHaveAttribute('data-stage', 'hush');
  await expect(tv.getByTestId('reveal-code')).toHaveAttribute('aria-label', `Code ${code}`);
  await expect(sequence).toHaveAttribute('data-stage', 'gather', { timeout: 15_000 });

  // A refresh in the middle picks up where the sequence is, not from the start.
  await tv.reload();
  await expect(tv.getByTestId('reveal-sequence')).toHaveAttribute('data-stage', /gather|tension/);

  await expect(tv.getByTestId('reveal-sequence')).toHaveAttribute('data-stage', 'countdown', { timeout: 20_000 });
  await expect(tv.getByText('3', { exact: true })).toBeVisible({ timeout: 5_000 });
  expect(resultRequests).toEqual([]); // nobody has asked for the result during the build-up (real API: see below)

  const result = tv.getByTestId('reveal-result');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result.getByRole('heading')).toHaveText(/^IT’S A (BOY|GIRL)!$/);
  if (testInfo.project.name === 'local-api') {
    // Against the real API: the first request came at the reveal moment (30 s after the code), not before.
    // (The mock answers in the browser, without network requests.)
    expect(resultRequests.length).toBeGreaterThan(0);
    expect(resultRequests[0]! - unlockedAt).toBeGreaterThan(29_000);
  }
  await tv.screenshot({ path: testInfo.outputPath('reveal-result.png') });

  // Phones never show the result: they point at the TV.
  await expect(phone.getByText('Look at the big screen!')).toBeVisible();
  await expect(phone.getByText(/IT’S A|It’s a (boy|girl)/)).toHaveCount(0);
  await expect(phone.getByText(code)).toHaveCount(0); // the code is shown on the TV only

  // A TV that comes back much later goes straight to the celebration.
  await tv.reload();
  await expect(tv.getByTestId('reveal-sequence')).toHaveAttribute('data-stage', 'celebrate');
  await expect(tv.getByTestId('reveal-result')).toBeVisible();

  // The thank-you screen keeps the result.
  await hostAction(admin, 'Finish the event', 'Finish');
  await expect(tv.getByTestId('finished-result')).toHaveText(/^It’s a (boy|girl)$/);
});

test('a new rehearsal brings everyone back to the lobby, with nothing erased', async ({ evening }) => {
  const { admin, tv, phone } = evening;
  await joinAs(phone, 'Mia');
  await hostAction(admin, 'Start voting', 'Start voting');
  await expect(tv.getByRole('heading', { name: "What's your guess?" })).toBeVisible();

  await admin.getByRole('button', { name: 'Start a new rehearsal' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Start a new rehearsal' }).click();

  await expect(tv.getByRole('heading', { name: 'Welcome to Our Baby Reveal' })).toBeVisible();
  await expect(phone.getByLabel("What's your name?")).toBeVisible(); // Mia joins again
  await expect(admin.getByText('No link yet')).toBeVisible();
});

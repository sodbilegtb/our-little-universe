import { expect, hostAction, playThroughQuiz, PHONE, test } from './fixtures';

test('the doctor seals the answer with a one-time link, and the emailed code unlocks the reveal', async ({ evening }) => {
  const { admin, context } = evening;

  // The host creates the link. It's shown once, with a QR code.
  await admin.getByRole('button', { name: 'Create doctor link' }).click();
  const link = (await admin.getByTestId('doctor-link').textContent())!.trim();
  expect(link).toMatch(/\/doctor#[A-Za-z0-9_-]{43}$/);
  await expect(admin.getByRole('img', { name: 'QR code of the doctor link' })).toBeVisible();
  await expect(admin.getByText('Waiting for the doctor')).toBeVisible();

  // The doctor, on a phone. The token leaves the address bar at once.
  const doctor = await context.newPage();
  await doctor.setViewportSize(PHONE);
  await doctor.goto(link);
  await expect(doctor.getByRole('heading', { name: "What is the baby's gender?" })).toBeVisible();
  expect(doctor.url()).not.toContain('#');
  await expect(doctor.getByText('Test link')).toBeVisible();
  await doctor.getByRole('radio', { name: 'Girl' }).click();
  await doctor.getByRole('button', { name: 'Continue' }).click();
  await expect(doctor.getByRole('heading', { name: 'Please confirm' })).toBeVisible();
  await doctor.getByRole('button', { name: 'Seal my answer' }).click();
  await expect(doctor.getByRole('heading', { name: 'Sealed. Thank you.' })).toBeVisible();

  // Refreshing never creates anything new; the page knows the answer is sealed.
  await doctor.reload();
  await expect(doctor.getByRole('heading', { name: 'Already sealed' })).toBeVisible();

  // The host desk shows the state, never the answer. The link card is gone.
  await expect(admin.getByText('Sealed, code emailed')).toBeVisible();
  await expect(admin.getByTestId('doctor-link')).toHaveCount(0);

  // The reveal code from the (test) email.
  await admin.getByRole('button', { name: 'Show the last test email' }).click();
  const email = admin.getByTestId('test-email');
  await expect(email).toContainText('[TEST] OFFICIAL BABY REVEAL CODE');
  const code = /[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}/.exec((await email.textContent()) ?? '')![0];

  // Play through to the reveal and unlock it.
  await hostAction(admin, 'Start voting', 'Start voting');
  await hostAction(admin, 'Close voting', 'Close voting');
  await hostAction(admin, 'Start the quiz', 'Start the quiz');
  await hostAction(admin, 'Open question 1');
  await playThroughQuiz(admin);
  await hostAction(admin, 'Start messages for baby', 'Start messages');
  await hostAction(admin, 'Start the reveal', 'Start the reveal');
  await admin.getByLabel('Reveal code').fill(code);
  await admin.getByRole('button', { name: 'Unlock the reveal' }).click();
  await expect(admin.getByText('The code was accepted. The reveal is on the TV now.')).toBeVisible();

  // Once the reveal has begun, the secret can't be reset or re-issued.
  await expect(admin.getByRole('button', { name: 'Reset the secret' })).toHaveCount(0);
  await expect(admin.getByRole('button', { name: /doctor link/ })).toHaveCount(0);
});

test('a reset retires the sealed answer, its code and the doctor link', async ({ evening }) => {
  const { admin, context } = evening;
  await admin.getByRole('button', { name: 'Create doctor link' }).click();
  const link = (await admin.getByTestId('doctor-link').textContent())!.trim();

  await admin.getByRole('button', { name: 'Reset the secret' }).click();
  const dialog = admin.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Reset the secret' })).toBeDisabled();
  await dialog.getByLabel('Type RESET to confirm').fill('reset');
  await dialog.getByRole('button', { name: 'Reset the secret' }).click();
  await expect(admin.getByText('No link yet')).toBeVisible();

  const doctor = await context.newPage();
  await doctor.setViewportSize(PHONE);
  await doctor.goto(link);
  await expect(doctor.getByRole('heading', { name: 'This link can’t be used' })).toBeVisible();
});

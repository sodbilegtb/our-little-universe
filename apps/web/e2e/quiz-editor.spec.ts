import { expect, hostAction, joinAs, test } from './fixtures';

test('the host edits a question, guests see it, and editing locks during the quiz', async ({ evening }) => {
  const { admin, phone } = evening;
  await joinAs(phone, 'Clara');

  await admin.getByRole('button', { name: /Who is better at cooking\?/ }).click();
  const question = admin.getByLabel('Question', { exact: true });
  await question.fill('Who sings louder in the car?');
  await admin.getByRole('textbox', { name: 'Answer C' }).fill('A tie, sadly');
  await admin.getByRole('radio', { name: 'Mark answer B as correct' }).click();
  await expect(admin.getByText('Unsaved changes')).toBeVisible();

  // Invalid input is caught before saving.
  await admin.getByRole('textbox', { name: 'Answer D' }).fill('');
  await admin.getByRole('button', { name: 'Save quiz' }).click();
  await expect(admin.getByText('Fill in answer D.')).toBeVisible();
  await admin.getByRole('textbox', { name: 'Answer D' }).fill('Nobody');
  await admin.getByRole('button', { name: 'Save quiz' }).click();
  await expect(admin.getByText('Saved', { exact: true })).toBeVisible();

  await hostAction(admin, 'Start voting', 'Start voting');
  await hostAction(admin, 'Close voting', 'Close voting');
  await hostAction(admin, 'Start the quiz', 'Start the quiz');
  await expect(admin.getByText('Locked during the quiz')).toBeVisible();
  await hostAction(admin, 'Open question 1');

  await expect(phone.getByRole('heading', { name: 'Who sings louder in the car?' })).toBeVisible();
  await expect(phone.getByRole('button', { name: /A tie, sadly/ })).toBeVisible();
});

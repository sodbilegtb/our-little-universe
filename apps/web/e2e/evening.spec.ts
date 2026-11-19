import { expect, hostAction, joinAs, playThroughQuiz, test } from './fixtures';

test('a full evening across a guest phone, the TV and the host desk', async ({ evening }) => {
  const { tv, admin, phone } = evening;

  // Welcome: the TV shows the QR code, the guest joins and survives a refresh.
  await expect(tv.getByRole('heading', { name: 'Welcome to Our Baby Reveal' })).toBeVisible();
  await expect(tv.getByRole('img', { name: 'QR code to join the celebration' })).toBeVisible();
  await joinAs(phone, 'Mia');
  await expect(tv.getByText('10 guests have joined')).toBeVisible();
  await phone.reload();
  await expect(phone.getByRole('heading', { name: "You're in!" })).toBeVisible();

  // Voting
  await hostAction(admin, 'Start voting', 'Start voting');
  await expect(phone.getByRole('heading', { name: "What's your guess?" })).toBeVisible();
  await expect(tv.getByRole('heading', { name: "What's your guess?" })).toBeVisible();
  await phone.getByRole('button', { name: 'Vote Girl' }).click();
  await expect(phone.getByRole('heading', { name: 'Your vote is in!' })).toBeVisible();
  await expect(tv.getByText('vote so far')).toBeVisible();
  await phone.reload();
  await expect(phone.getByRole('heading', { name: 'Your vote is in!' })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Vote Boy' })).toHaveCount(0);

  // Quiz: question 1 with a real answer from the phone
  await hostAction(admin, 'Close voting', 'Close voting');
  await hostAction(admin, 'Start the quiz', 'Start the quiz');
  await expect(tv.getByRole('heading', { name: 'Mom vs. Dad' })).toBeVisible();
  await expect(phone.getByRole('heading', { name: 'Mom vs. Dad' })).toBeVisible();
  await hostAction(admin, 'Open question 1');
  await expect(phone.getByRole('heading', { name: 'Who is better at cooking?' })).toBeVisible();
  await expect(tv.getByRole('heading', { name: 'Who is better at cooking?' })).toBeVisible();
  await phone.getByRole('button', { name: /Dad/ }).click();
  await expect(phone.getByText('Answer locked in. Waiting for everyone else.')).toBeVisible();
  await expect(tv.getByText(/1\s*of 10 answered/)).toBeVisible();
  await hostAction(admin, 'Close question');
  await hostAction(admin, 'Reveal the answer');
  await expect(phone.getByRole('heading', { name: 'Not this time' })).toBeVisible();
  await expect(phone.getByText('The answer was “Mom”.')).toBeVisible();

  // The rest of the quiz, host-paced
  await hostAction(admin, 'Open question 2');
  await playThroughQuiz(admin, 2);
  await expect(tv.getByText('And the quiz goes to')).toBeVisible();

  // Messages
  await hostAction(admin, 'Start messages for baby', 'Start messages');
  await expect(phone.getByRole('heading', { name: 'A Message for Our Little One' })).toBeVisible();
  await phone.getByLabel('From Mia').fill('We already love you to the moon and back.');
  await phone.getByRole('button', { name: 'Send my star' }).click();
  await expect(phone.getByRole('heading', { name: 'Your little star has been saved.' })).toBeVisible();
  await expect(tv.getByText(/1\s*star in our sky/)).toBeVisible();
  await expect(tv.getByText('We already love you to the moon and back.')).toHaveCount(0); // not approved yet
  await admin.getByRole('button', { name: 'Show on TV' }).click();
  await expect(tv.getByText('We already love you to the moon and back.')).toBeVisible();

  // Removing is reversible: the message leaves the TV and comes back on restore.
  await admin.getByRole('button', { name: 'Remove', exact: true }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Remove message' }).click();
  await expect(tv.getByText('We already love you to the moon and back.')).toHaveCount(0);
  await admin.getByRole('button', { name: 'Removed messages (1)' }).click();
  await admin.getByRole('button', { name: 'Restore' }).click();
  await expect(tv.getByText('We already love you to the moon and back.')).toBeVisible();

  // Reveal: phones point at the TV; a simulated doctor (test mode) provides the code.
  await admin.getByRole('button', { name: 'Simulate the doctor (test)' }).click();
  const code = (await admin.getByTestId('test-code').textContent())!.trim();
  await expect(admin.getByText('Sealed, code emailed')).toBeVisible();
  await hostAction(admin, 'Start the reveal', 'Start the reveal');
  await expect(phone.getByRole('heading', { name: "The moment we've all been waiting for..." })).toBeVisible();
  await expect(phone.getByText('Look at the big screen!')).toBeVisible();
  await expect(tv.getByRole('heading', { name: 'THE FINAL SECRET' })).toBeVisible();
  await admin.getByLabel('Reveal code').fill('2222-2222-2222');
  await admin.getByRole('button', { name: 'Unlock the reveal' }).click();
  await expect(admin.getByText('That code doesn’t unlock the reveal. Check it and try again.')).toBeVisible();
  await admin.getByLabel('Reveal code').fill(code.toLowerCase().replace(/-/g, ''));
  await admin.getByRole('button', { name: 'Unlock the reveal' }).click();
  await expect(admin.getByText('The code was accepted. The reveal is on the TV now.')).toBeVisible();

  await hostAction(admin, 'Finish the event', 'Finish');
  await expect(phone.getByRole('heading', { name: 'Thank you for being part of our little universe' })).toBeVisible();
  await expect(tv.getByRole('heading', { name: 'Thank you for being part of our little universe' })).toBeVisible();

  // Keep the evening: the archive holds Mia's vote, answer and message.
  await admin.getByRole('button', { name: 'Prepare downloads' }).click();
  await expect(admin.getByText(/^10 guests, \d+ votes?, \d+ quiz answers? and 1 message\.$/)).toBeVisible();
  const download = admin.waitForEvent('download');
  await admin.getByRole('button', { name: 'Complete archive (JSON)' }).click();
  const archive = JSON.parse(await readDownload(await download)) as {
    voting: { votes: { displayName: string; choice: string }[] };
    quiz: { questions: { answers: { displayName: string; correct: boolean }[] }[] };
    messages: { displayName: string; text: string; removed: boolean }[];
  };
  expect(archive.voting.votes).toContainEqual(expect.objectContaining({ displayName: 'Mia', choice: 'GIRL' }));
  expect(archive.quiz.questions[0]!.answers).toContainEqual(expect.objectContaining({ displayName: 'Mia', correct: false }));
  expect(archive.messages).toEqual([
    expect.objectContaining({ displayName: 'Mia', text: 'We already love you to the moon and back.', removed: false }),
  ]);
});

async function readDownload(download: import('@playwright/test').Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

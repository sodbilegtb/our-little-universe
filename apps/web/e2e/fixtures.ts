import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

const ADMIN_PASSWORD = 'e2e-host-password';

/** One evening: TV, host desk and a guest phone sharing one browser context (one mock event). */
export interface Evening {
  context: BrowserContext;
  tv: Page;
  admin: Page;
  phone: Page;
  /** Opens another guest phone in the same event. */
  newPhone: (slot: number) => Promise<Page>;
}

export const PHONE = { width: 390, height: 844 };

export const test = base.extend<{ evening: Evening }>({
  evening: async ({ browser }, use) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const admin = await context.newPage();
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.goto('/admin');
    await admin.getByLabel('Host password').fill(ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await expect(admin.getByText('Live now')).toBeVisible();
    // Start every test from a fresh event with nine placeholder guests (mock or local API).
    await admin.waitForFunction(() => '__olu' in window);
    await admin.evaluate(() => (window as unknown as { __olu: { reset: () => Promise<void> } }).__olu.reset());
    await admin.reload();
    await expect(admin.getByText('Live now')).toBeVisible();

    const tv = await context.newPage();
    await tv.setViewportSize({ width: 1920, height: 1080 });
    await tv.goto('/tv');

    const newPhone = async (slot: number) => {
      const page = await context.newPage();
      await page.setViewportSize(PHONE);
      await page.goto(slot === 1 ? '/party' : `/party?slot=${slot}`);
      return page;
    };
    const phone = await newPhone(1);

    await use({ context, tv, admin, phone, newPhone });
    await context.close();
  },
});

export { expect };

/** Clicks a host action and, if a confirmation appears, confirms it. */
export async function hostAction(admin: Page, label: string, confirmLabel?: string) {
  await admin.getByRole('button', { name: label, exact: true }).first().click();
  if (confirmLabel) {
    await admin.getByRole('alertdialog').getByRole('button', { name: confirmLabel, exact: true }).click();
    await expect(admin.getByRole('alertdialog')).toBeHidden();
  }
}

export async function joinAs(phone: Page, name: string) {
  await phone.getByLabel("What's your name?").fill(name);
  await phone.getByRole('button', { name: 'Join the Party' }).click();
  await expect(phone.getByRole('heading', { name: "You're in!" })).toBeVisible();
}

/** Walks the host through questions 1..10 without guest input, ending on the podium. */
export async function playThroughQuiz(admin: Page, fromQuestion = 1) {
  for (let n = fromQuestion; n <= 10; n += 1) {
    if (n > fromQuestion) await hostAction(admin, `Open question ${n}`);
    await hostAction(admin, 'Close question');
    await hostAction(admin, 'Reveal the answer');
  }
  await hostAction(admin, 'Finish the quiz');
}

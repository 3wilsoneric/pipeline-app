import { test, expect, chromium, webkit } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { createOperationalReferral } from './support/operational-api';
import { confirmReferralFileLabels } from './support/referral-upload';

for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]] as const) {
  test(`uploaded image renders and fits the phone; preview framing stays restricted on ${engine}`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const referral = await createOperationalReferral(page.request, 'assessmentCoordinator', {
        name: `Synthetic preview ${randomUUID()}`, owner: 'Annette Everhart', documentName: '', documentStatus: 'Missing',
      }, { assigneeId: 'provisional:allo:annette' });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=files`);
      const canvas = createCanvas(400, 500);
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = '#ffffff'; drawing.fillRect(0, 0, 400, 500);
      drawing.fillStyle = '#15583a'; drawing.fillRect(20, 20, 360, 110);
      drawing.fillStyle = '#ffffff'; drawing.font = '24px sans-serif'; drawing.fillText('SYNTHETIC FILE', 40, 80);
      const name = 'synthetic-assessment-preview.png';
      await page.getByLabel('Choose referral documents').setInputFiles({ name, mimeType: 'image/png', buffer: canvas.toBuffer('image/png') });
      const labeling = page.getByRole('dialog', { name: 'Label your files', exact: true });
      await expect(labeling).toBeVisible();
      const removeBox = (await labeling.getByRole('button', { name: `Remove ${name}` }).boundingBox())!;
      expect(removeBox.width).toBeGreaterThanOrEqual(44);
      expect(removeBox.height).toBeGreaterThanOrEqual(44);
      await confirmReferralFileLabels(page, { [name]: 'assessment' });
      await expect(page.getByTestId('workspace-save-status')).toContainText('Files uploaded');
      await page.getByRole('button', { name: `Delete ${name}`, exact: true }).tap();
      const deletion = page.getByRole('dialog', { name: 'Delete this file?', exact: true });
      await expect(deletion).toBeVisible();
      await page.screenshot({ path: info.outputPath(`delete-confirmation-${engine}.png`) });
      await deletion.getByRole('button', { name: 'Cancel', exact: true }).tap();
      await page.getByRole('button', { name: `Preview ${name}`, exact: true }).tap();
      const preview = page.getByRole('dialog', { name: `Preview ${name}`, exact: true });
      const image = preview.getByRole('img', { name: `Preview ${name}`, exact: true });
      await expect(image).toBeVisible();
      const src = (await image.getAttribute('src'))!;
      const response = await page.request.get(src);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
      expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers()['content-security-policy']).toContain("sandbox; default-src 'none'");
      expect((await page.request.get('/')).headers()['x-frame-options']).toBe('DENY');
      expect((await page.request.get(`/api/referrals/${referral.id}`)).headers()['x-frame-options']).toBe('DENY');
      expect((await page.request.get(src.replace('/preview', '/download'))).headers()['x-frame-options']).toBe('DENY');
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
      const box = (await image.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.height / box.width).toBeCloseTo(500 / 400, 1);
      // Exercise embedding too: PDFs still use an iframe, and the security-header
      // regression blocked otherwise-successful preview responses in both engines.
      await page.evaluate((src) => {
        const frame = document.createElement('iframe');
        frame.title = 'Same-origin preview policy probe'; frame.src = src; frame.hidden = true;
        document.body.appendChild(frame);
      }, src);
      const frame = page.locator('iframe[title="Same-origin preview policy probe"]');
      await expect.poll(async () => {
        const content = await (await frame.elementHandle())?.contentFrame();
        return content?.locator('img').evaluateAll((images) => images.some((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0));
      }).toBe(true);
      await page.screenshot({ path: info.outputPath(`loaded-preview-${engine}.png`) });
    } finally { await browser.close(); }
  });
}

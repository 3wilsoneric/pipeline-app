import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

for (const outcome of ['ready', 'unavailable'] as const) {
  test(`Beta extraction ${outcome} never blocks creation, manual edits, or assessment navigation`, async ({ page }) => {
    test.setTimeout(60000);
    let status = 'extracting';
    await page.route('**/api/packets/*/status', async route => {
      if (status === 'unavailable') return route.fulfill({ status:503, json:{ error:'synthetic_provider_unavailable' } });
      const response = await route.fetch();
      return route.fulfill({ json: { ...await response.json(), status } });
    });
    await page.goto('/?view=referrals&screen=packet');
    const beta = page.getByRole('region', { name:'Extraction review' });
    await expect(beta.getByText('Beta', { exact:true })).toBeVisible();
    await page.getByRole('textbox', { name:'NAME', exact:true }).fill(`Synthetic Beta ${outcome} ${randomUUID().replace(/[^a-f]/g, '')}`);
    await page.getByTestId('initial-packet-input').setInputFiles({ name:'synthetic-beta.pdf', mimeType:'application/pdf', buffer:Buffer.from(`synthetic-beta-${randomUUID()}`) });
    await page.getByRole('button', { name:'Create referral', exact:true }).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('referralId')).not.toBeNull();
    await expect(beta).toContainText('background');
    const referralId=new URL(page.url()).searchParams.get('referralId');
    const dob=page.getByLabel('Date of birth', { exact:true });
    await dob.fill('1984-06-12'); await dob.blur();
    await expect.poll(async()=> (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral.dob).toBe('1984-06-12');
    status=outcome==='ready' ? 'ready_for_review' : 'unavailable';
    if(outcome==='ready') {
      await expect(beta.getByRole('button',{name:'Review fields',exact:true})).toBeVisible({timeout:15000});
      await beta.getByRole('button',{name:'Review fields',exact:true}).click();
      await expect(dob).toHaveValue('1984-06-12');
      await beta.getByRole('button',{name:'Edit extracted Date of birth'}).click();
      await beta.getByRole('textbox',{name:'Correct Date of birth'}).fill('1984-06-13');
      await beta.getByRole('button',{name:'Save correction'}).click();
      await expect(dob).toHaveValue('1984-06-13');
    } else {
      await expect(beta).toContainText('Suggestions are unavailable',{timeout:15000});
      await expect(dob).toHaveValue('1984-06-12');
    }
    await page.getByRole('button',{name:'02 Questionnaire'}).click();
    await expect(page.getByRole('region',{name:'Intake',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'01 Intake'}).click();
    await expect(dob).toHaveValue(outcome==='ready'?'1984-06-13':'1984-06-12');
  });
}

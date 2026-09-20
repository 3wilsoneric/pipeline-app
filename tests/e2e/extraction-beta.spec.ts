import { confirmReferralFileLabels } from "./support/referral-upload";
import { referralDocumentAutofillEnabled } from "../../lib/extraction/contracts";
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('an unscanned approved upload opens without waiting for OCR or page rendering', async ({ page }) => {
  const id='09f8c5b9-9f52-4668-a7bf-d70c6086b686';
  const name='Synthetic unscanned upload.pdf';
  await page.route(/\/api\/files\?/, route => route.fulfill({json:{files:[{
    id,name,category:'Other',referralId:1,referralName:'Synthetic Upload',community:'San Pablo',
    owner:'Test',uploadedAt:'2026-09-18T12:00:00.000Z',sizeBytes:100,status:'Uploaded',
    contentType:'application/pdf',previewStatus:'pending',sourceSystem:'pipeline',
    previewUrl:`/api/files/${id}/preview`,downloadUrl:`/api/files/${id}/download`,
  }],total:1,next_cursor:null}}));
  await page.route(`**/api/files/${id}?*`, route => route.fulfill({json:{file:{
    document_id:id,file_name:name,category:'other',content_type:'application/pdf',byte_size:100,
    processing_status:'uploaded',preview_status:'pending',malware_scan_status:'not_scanned',
    page_count:null,pages:[],
  }}}));
  await page.route(`**/api/files/${id}/preview`, route => route.fulfill({contentType:'text/plain',body:'Synthetic preview'}));
  await page.goto('/?view=referrals');
  await page.getByRole('button',{name:/^All files/}).click();
  await page.getByRole('button',{name:new RegExp(name)}).click();
  const dialog=page.getByRole('dialog',{name:`Preview ${name}`});
  await expect(dialog.locator('iframe')).toHaveAttribute('src',`/api/files/${id}/preview`);
  await expect(dialog).not.toContainText('Safety scan pending');
});

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
    const documents = page.getByTestId('document-checklist-toggle');
    await expect(documents.getByText('Beta', { exact:true })).toBeVisible();
    await expect(beta).toBeHidden();
    await documents.click();
    await expect(beta).toBeVisible();
    await page.getByRole('textbox', { name:'NAME', exact:true }).fill(`Synthetic Beta ${outcome} ${randomUUID().replace(/[^a-f]/g, '')}`);
    await page.getByTestId('referral-documents-input').setInputFiles({ name:'synthetic-beta.pdf', mimeType:'application/pdf', buffer:Buffer.from(`synthetic-beta-${randomUUID()}`) });
    await confirmReferralFileLabels(page, {}, "face_sheet");
    await page.getByRole('button', { name:'Create referral', exact:true }).click();
    await expect.poll(()=>new URL(page.url()).searchParams.get('referralId')).not.toBeNull();
    await page.getByRole('button', { name:'Edit referral details', exact:true }).click();
    await documents.click();
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
    await page.getByRole('button',{name:'Assessment', exact:true}).click();
    await expect(page.getByRole('region',{name:'Intake',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Chart', exact:true}).click();
    await page.getByRole('button',{name:'Edit referral details', exact:true}).click();
    await expect(dob).toHaveValue(outcome==='ready'?'1984-06-13':'1984-06-12');
  });
}

// Kept for the future extraction rollout; attachment-only.spec.ts covers the paused product.
test.skip(!referralDocumentAutofillEnabled, "Document reading and autofill are temporarily disabled.");

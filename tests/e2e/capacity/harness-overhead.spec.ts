import { test } from '@playwright/test';

// Isolate the load generator's action bookkeeping from Pipeline, networking,
// and PostgreSQL. Both variants execute exactly the same real browser calls.
for (const scoped of [false, true]) {
  test(`capacity action bookkeeping ${scoped ? 'actor step' : 'flat baseline'}`, async ({ page }, testInfo) => {
    test.skip(testInfo.config.metadata.pipelineCapacityRehearsal !== true, 'Dedicated diagnostic only');
    test.setTimeout(180_000);
    await page.goto('about:blank');
    const batches: Array<{ actions: number; elapsed_ms: number }> = [];
    const actions = async () => {
      for (let batch = 0; batch < 12; batch++) {
        const start = performance.now();
        for (let action = 0; action < 1_000; action++) {
          if (await page.evaluate(() => true) !== true) throw Error('Browser evaluation failed');
        }
        batches.push({ actions: (batch + 1) * 1_000, elapsed_ms: performance.now() - start });
      }
    };
    if (scoped) await test.step('one sustained actor', actions);
    else await actions();
    await testInfo.attach('bookkeeping-timings', { body: JSON.stringify({ scoped, batches }), contentType: 'application/json' });
  });
}

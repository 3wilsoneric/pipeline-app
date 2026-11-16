import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const contexts = [
  ['Harbor Hospital','Contra Costa','San Pablo','Alex Morgan'],
  ['County placement team','Los Angeles','Santa Clarita','Sam Rivera'],
  ['Meadow Rehabilitation','Sonoma','San Pablo','Robin Chen'],
  [null,'Stanislaus','Turlock','Sam Rivera'],
] as const;
const rows = ['Avery Thompson-Williams','Jordan Ellis','Morgan De La Cruz-Santiago','Casey Brooks','Jamie Robinson','Riley Parker','Taylor Quinn','Cameron Bennett'].map((client_name,i)=>({
 referral_id:900+i, client_name, community:contexts[i%4][2], owner:contexts[i%4][3], source_name:contexts[i%4][0], referring_county:contexts[i%4][1], prior_placement:'Community hospital', pipeline_path:`/?view=referrals&screen=packet&referralId=${900+i}`,
 completed_at:`2026-11-${String(15-i%5).padStart(2,'0')}T20:00:00Z`, decision:i%3===0?'pending':i%3===1?'accepted':'declined'
}));
const report={generated_at:'2026-11-16T16:00:00Z',board_columns:[],briefing:{
 window_end:'2026-11-16',week_start:'2026-11-16',week_end:'2026-11-22',last_week_start:'2026-11-09',last_week_end:'2026-11-15',
 coverage:{assessed_last_week_complete:true,accepted_last_week_complete:true,admitted_last_week_complete:true,assessments_complete:true,move_ins_complete:true,moving_through_complete:true,did_not_move_in_complete:true},
 assessed_last_week:rows,accepted_last_week:rows.slice(0,3).map(r=>({...r,accepted_at:r.completed_at,planned_at:null,admitted_at:null,cancelled:false})),
 admitted_last_week:rows.slice(4,6).map(r=>({...r,admitted_at:'2026-11-13'})),
 upcoming_assessments:[{...rows[0],scheduled_at:'2026-11-17T18:30:00Z',status:'Scheduled'}],
 planned_move_ins:[{...rows[1],planned_at:'2026-11-18',readiness:'ready'}],
 moving_through:[{...rows[2],stage:'decision',phase:'needs_date',planned_at:null,status:'Accepted · no planned admit date'}],did_not_move_in:[]
}};
const census={source:'alamo_platform',snapshot_id:'synthetic-monday',generated_at:report.generated_at,retrieved_at:report.generated_at,data_as_of:'2026-11-16',freshness:{status:'fresh',age_hours:0,max_age_hours:24,warning:null},portfolio_census_total:546,roster_count:546,reconciliation_status:'matched',delta:0,
 communities:[['337','San Pablo',154,175,225],['345','Santa Clarita',136,150,150],['342','Victoria’s House',40,46,46],['343','JC Wallace House',137,150,150],['344','Turlock',79,84,84]].map(([id,name,count,operating_capacity,licensed_capacity])=>({operating_capacity,licensed_capacity,capacity_as_of:'2026-07-30',community_id:id,community_name:name,city:'Example',state:'CA',current_census:count,roster_count:count,reconciliation_status:'matched',delta:0})),
 weekly_movement:[{week_start:'2026-11-09',week_end:'2026-11-15',complete:true,communities:[['337','San Pablo',3,1],['345','Santa Clarita',2,0],['342','Victoria’s House',0,1],['343','JC Wallace House',1,2],['344','Turlock',2,0]].map(([id,name,admissions,discharges])=>({community_id:id,community_name:name,admissions,discharges}))}]
};
for(const width of [1440,390,320]) test(`Monday briefing and drilldowns ${width}px`,async({page},info)=>{
 await page.clock.setFixedTime(new Date('2026-11-16T18:00:00Z'));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:950});
 await page.emulateMedia({reducedMotion:width===390?'reduce':'no-preference'});
 await page.route('**/api/auth/me',async route=>{const response=await route.fetch();const json=await response.json();json.user.roles=['admin'];json.user.email='reports@pipeline.local';delete json.user.demoPersona;await route.fulfill({response,json});});
 await page.route('**/api/operations/admissions-census',route=>route.fulfill({json:report}));
 await page.route('**/api/clinical/census',route=>route.fulfill({json:census}));
 await page.goto('/?screen=operations');
 const main=page.getByRole('main',{name:'Reports'});
 await expect(main.getByRole('heading',{name:'Monday briefing'})).toBeVisible();
 const last=main.getByRole('region',{name:'Last week',exact:true});
 await expect(last.getByRole('button',{name:/8 Assessments/})).toBeVisible();
 await expect(last.getByRole('link',{name:'Avery Thompson-Williams'})).toBeVisible();
 await page.screenshot({path:info.outputPath(`monday-${width}.png`)});
 await last.getByLabel('Referral origin').selectOption('Harbor Hospital');
 await expect(last.getByRole('link')).toHaveCount(2);
 await last.getByLabel('Referral origin').selectOption('all');
 const expand=last.getByRole('button',{name:'View all 8 clients'});await expand.click();
 const dialog=page.getByRole('dialog',{name:'Weekly client details'});
 await expect(dialog.getByRole('link',{name:'Cameron Bennett'})).toHaveAttribute('href',/referralId=907/);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(expand).toBeFocused();
 await last.getByRole('button',{name:'3 Accepted'}).click();
 await expect(last.getByText(/Needs admit date/)).toHaveCount(3);
 await last.getByRole('button',{name:'2 Admitted'}).click();
 await expect(last.getByRole('link')).toHaveCount(2);
 const upcoming=main.getByRole('region',{name:'This week',exact:true});
 await expect(upcoming.getByText(/Nov 17, 10:30 AM PT/)).toBeVisible();
 await expect(upcoming.getByText('Planned admit',{exact:true})).toBeVisible();
 await main.getByRole('region',{name:'Admissions versus discharges'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath(`flow-${width}.png`)});
 const sanPablo=main.getByRole('meter',{name:'San Pablo occupancy'});
 await expect(sanPablo).toHaveAttribute('aria-valuemax','175');
 await expect(sanPablo).toHaveAttribute('aria-valuenow','154');
 expect(await sanPablo.locator('i').evaluate(el=>parseFloat((el as HTMLElement).style.width))).toBeCloseTo(88);
 await expect.poll(async()=>sanPablo.evaluate(el=>el.querySelector('i')!.getBoundingClientRect().width/el.getBoundingClientRect().width)).toBeCloseTo(.88,2);
 const turlock=main.getByRole('meter',{name:'Turlock occupancy'});
 await expect(turlock).toHaveAttribute('aria-valuemax','84');
 expect(await turlock.locator('i').evaluate(el=>parseFloat((el as HTMLElement).style.width))).toBeCloseTo(79/84*100);
 const moving=main.getByRole('region',{name:'Clients moving through'});
 await expect(moving.getByRole('button')).toHaveCount(0);
 await expect(moving.getByRole('combobox')).toHaveCount(0);
 await expect(moving.getByText('Needs admit date',{exact:true})).toHaveCount(1);
 await expect(moving.getByText(/Select a client|shown|View all/)).toHaveCount(0);
 await moving.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath(`moving-${width}.png`)});
 const sources=main.locator('footer details');
 await expect(sources).not.toHaveAttribute('open','');
 await sources.locator('summary').focus();await page.keyboard.press('Enter');
 await expect(sources.getByText(/175 operating \/ 225 licensed/)).toBeVisible();
 await page.keyboard.press('Enter');

 await expect(main.getByText('8 admissions',{exact:true})).toBeVisible();
 await expect(main.getByText('4 discharges',{exact:true})).toBeVisible();
 expect(await main.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.addScriptTag({content:axeSource});
 const violations=await page.evaluate(async()=> (await (window as unknown as {axe:{run:(element:Element|null,options:unknown)=>Promise<{violations:unknown[]}>}}).axe.run(document.querySelector('[data-testid="operations-workspace"]'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations);
 expect(violations).toEqual([]);
 // An older or delayed Platform feed is unknown, not zero discharges.
 await page.route('**/api/clinical/census',route=>route.fulfill({json:{...census,weekly_movement:[]}}));
 await main.getByRole('button',{name:'Refresh report'}).click();
 await expect(main.getByText(/Weekly flow unavailable/)).toBeVisible();
 await expect(main.getByText('4 discharges',{exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
 await page.goto('/');
 await expect(page.getByRole('link',{name:/Monday briefing/})).toBeVisible();
 await page.getByRole('link',{name:/Monday briefing/}).click();
 await expect(page.getByRole('heading',{name:'Monday briefing'})).toBeVisible();
});

test('capacity absence, effective dates and excess census are explicit',async({page})=>{
 await page.route('**/api/auth/me',async route=>{const response=await route.fetch();const json=await response.json();json.user.roles=['admin'];json.user.email='reports@pipeline.local';delete json.user.demoPersona;await route.fulfill({response,json});});
 await page.route('**/api/operations/admissions-census',route=>route.fulfill({json:report}));
 await page.route('**/api/clinical/census',route=>route.fulfill({json:{...census,communities:census.communities.map((row,i)=>i===0?{...row,current_census:180}:i===1?{...row,operating_capacity:undefined,licensed_capacity:undefined}:i===2?{...row,capacity_as_of:'2026-12-01'}:row)}}));
 await page.goto('/?screen=operations');
 const flow=page.getByRole('region',{name:'Admissions versus discharges'});
 await expect(flow.getByRole('meter',{name:'San Pablo occupancy'})).toHaveAttribute('aria-valuetext','180 of 175 operating beds, 5 above capacity');
 await expect(flow.getByRole('meter',{name:'San Pablo occupancy'}).locator('i')).toHaveAttribute('style','width: 100%;');
 await expect(flow.getByRole('meter',{name:'Santa Clarita occupancy'})).toHaveCount(0);
 await expect(flow.getByRole('meter',{name:'Victoria’s House occupancy'})).toHaveCount(0);
 await expect(flow.getByText('Capacity unavailable',{exact:true})).toHaveCount(2);
 await expect(flow.getByText('5 above capacity',{exact:true})).toBeVisible();
});

const briefingViewers = [
 {id:'f73371d5-d2b4-48b4-a32b-1edc7c88869f',name:'Eric',roles:['admin']},
 {id:'e9f39185-d751-45c0-bcf5-c24d3565bdd9',name:'Andrew',roles:['assessment_coordinator']},
 {id:'b72c34f0-0ee8-4ab4-8359-81c8f7b0d3b2',name:'Sandeep',roles:['assessment_coordinator']},
];
for(const viewer of briefingViewers) test(`${viewer.name} sees the Monday pin only on Pacific Mondays and keeps Reports`, async({page})=>{
 await page.clock.install({time:new Date('2026-11-16T07:59:50Z')}); // Still Sunday in California.
 await page.route('**/api/auth/me',async route=>{const response=await route.fetch();const json=await response.json();Object.assign(json.user,viewer,{email:'guest-alias@example.invalid'});delete json.user.demoPersona;await route.fulfill({response,json});});
 await page.route('**/api/operations/admissions-census',route=>route.fulfill({json:report}));
 await page.route('**/api/clinical/census',route=>route.fulfill({json:census}));
 await page.goto('/');
 await expect(page.locator('[data-guide-target="home-workspace"]')).toBeVisible();
 const pin=page.getByRole('link',{name:/Monday briefing/});
 await expect(pin).toHaveCount(0);
 await page.clock.fastForward(31_000);await expect(pin).toBeVisible();
 await pin.click();await expect(page.getByRole('heading',{name:'Monday briefing'})).toBeVisible();
 await page.clock.setSystemTime(new Date('2026-11-17T07:59:50Z'));await page.goto('/');
 await expect(pin).toBeVisible();
 await page.clock.fastForward(31_000);await expect(pin).toHaveCount(0);
 await page.goto('/?screen=operations');await expect(page.getByRole('heading',{name:'Monday briefing'})).toBeVisible();
});

test('Monday pin stays hidden from other assessors and unnamed supervisors',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-16T18:00:00Z'));
 for(const roles of [['assessor'],['assessment_coordinator']]) {
  await page.route('**/api/auth/me',async route=>{const response=await route.fetch();const json=await response.json();Object.assign(json.user,{id:'unapproved-supervisor',email:'unapproved@example.invalid',roles});delete json.user.demoPersona;await route.fulfill({response,json});});
  await page.goto('/');await expect(page.locator('[data-guide-target="home-workspace"]')).toBeVisible();
  await expect(page.getByRole('link',{name:/Monday briefing/})).toHaveCount(0);
  await page.goto('/?screen=operations');await expect(page.getByTestId('operations-workspace')).toHaveCount(0);
 }
});

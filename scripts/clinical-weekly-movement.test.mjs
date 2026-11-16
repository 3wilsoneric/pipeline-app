import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEntry } from './contact-import-fixtures.mjs';
const { parseClinicalCensusResponse } = loadEntry('lib/clinical/clinical-contracts.ts');
const base = {source:'alamo_platform',snapshot_id:'synthetic',generated_at:'2026-11-16T14:00:00Z',retrieved_at:'2026-11-16T15:00:00Z',data_as_of:'2026-11-16',freshness:{status:'fresh',age_hours:1,max_age_hours:24,warning:null},communities:[{community_id:'337',community_name:'San Pablo',city:'San Pablo',state:'CA',current_census:100,roster_count:100,reconciliation_status:'matched',delta:0}],portfolio_census_total:100,roster_count:100,reconciliation_status:'matched',delta:0};
const week = {week_start:'2026-11-09',week_end:'2026-11-15',complete:true,communities:[{community_id:'337',community_name:'San Pablo',admissions:4,discharges:2}]};
test('clinical parser accepts additive weekly counts and older census-only feeds',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(parseClinicalCensusResponse({...base,weekly_movement:[week]}).weekly_movement)),[week]);
 assert.equal(parseClinicalCensusResponse(base).weekly_movement.length,0);
});
test('incomplete weekly counts remain unknown and cannot claim completeness',()=>{
 const partial={...week,complete:false,communities:[{...week.communities[0],discharges:null}]};
 assert.equal(parseClinicalCensusResponse({...base,weekly_movement:[partial]}).weekly_movement[0].communities[0].discharges,null);
 for(const invalid of [{...partial,complete:true},{...week,communities:[]},{...week,week_end:'2026-11-16'},{...week,communities:[week.communities[0],week.communities[0]]},{...week,communities:[{...week.communities[0],admissions:-1}]}]) {
  assert.throws(()=>parseClinicalCensusResponse({...base,weekly_movement:[invalid]}));
 }
 assert.throws(()=>parseClinicalCensusResponse({...base,data_as_of:'2026-11-15',weekly_movement:[week]}));
 assert.throws(()=>parseClinicalCensusResponse({...base,weekly_movement:[week,week]}));
});

test('capacity uses explicit positive operating and licensed limits, while legacy feeds stay unknown',()=>{
 const community={...base.communities[0],operating_capacity:175,licensed_capacity:225,capacity_as_of:'2026-07-30'};
 const response=parseClinicalCensusResponse({...base,communities:[community]});
 assert.equal(response.communities[0].operating_capacity,175);
 assert.equal(response.communities[0].licensed_capacity,225);
 assert.equal(response.communities[0].capacity_as_of,'2026-07-30');
 assert.equal(parseClinicalCensusResponse(base).communities[0].operating_capacity,null);
 for(const value of [0,-1,1.5,'175',NaN]) assert.throws(()=>parseClinicalCensusResponse({...base,communities:[{...community,operating_capacity:value}]}));
 assert.throws(()=>parseClinicalCensusResponse({...base,communities:[{...community,licensed_capacity:150}]}));
 assert.throws(()=>parseClinicalCensusResponse({...base,communities:[{...community,capacity_as_of:'unknown'}]}));
 assert.equal(parseClinicalCensusResponse({...base,communities:[{...community,current_census:180}]}).communities[0].current_census,180);
});

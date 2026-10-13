import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {isSupplierRequestV3,isSupplierResultV3,isSupplierDiscovery} from '../src/supplier-v3.ts';
import {getSupplierQuestions,calculateSupplierDeadlinesV3} from '../src/api.ts';
const fresh=JSON.parse(readFileSync(new URL('./fixtures/supplier_nj_workflow_v1.json',import.meta.url)));
const KEY='ld_live_'+'a'.repeat(32)+'.'+'b'.repeat(43);
const BASE='https://secure-api-v1.liendeadline.com';
for(const item of fresh.cases)test(`actual NJ nine-field API response ${item.id}`,()=>{
  assert.equal(isSupplierRequestV3(item.request),true);
  assert.equal(isSupplierResultV3(item.result,item.request),true);
});
for(const hired of ['owner','contractor','subcontractor'])test(`NJ discovery optional metadata forwards unchanged and same-date acts survive transport ${hired}`,async t=>{
  const review=fresh.cases.find(r=>r.id===`nj_residential_${hired}_actual`);
  const request=review.request;
  const scope=Object.fromEntries(['contract_version','state','role','project_type','hired_by'].map(k=>[k,request[k]]));
  assert.equal(isSupplierDiscovery(review.discovery,scope),true);
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return Response.json(options.body?review.result:review.discovery);});
  const discovery=await getSupplierQuestions(BASE,scope,KEY);
  assert.deepEqual(discovery,review.discovery);
  assert.equal(discovery.questions.find(q=>q.id==='nj_nub_lodged').optional,true);
  const result=await calculateSupplierDeadlinesV3(BASE,request,KEY);
  assert.deepEqual(result,review.result);assert.deepEqual(JSON.parse(calls[1].options.body),request);
  assert.deepEqual(result.preliminary_notice.notice_duties.map(d=>[d.id,d.deadline]),[['nj_nub_service','2026-09-11'],['nj_arbitration_demand','2026-09-11']]);
});
test('NJ malformed duplicate same-date ID and wrong exact input echo are rejected',()=>{
  const item=fresh.cases.find(r=>r.id==='nj_residential_contractor_actual');
  for(const mutate of [r=>r.preliminary_notice.notice_duties[1].id='nj_nub_service',r=>r.preliminary_notice.notice_duties[0].extra=true,
    r=>r.inputs.events.nj_nub_lodged.date='2026-09-05']){
    const result=structuredClone(item.result);mutate(result);assert.equal(isSupplierResultV3(result,item.request),false);
  }
});

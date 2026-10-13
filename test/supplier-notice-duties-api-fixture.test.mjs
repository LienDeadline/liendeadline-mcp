import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isSupplierRequestV3, isSupplierResultV3 } from '../src/supplier-v3.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/supplier_notice_duties_v1.json', import.meta.url), 'utf8'));
for (const item of fixture.cases) {
  test(`API named-notice fixture validates unchanged: ${item.id}`, () => {
    assert.equal(isSupplierRequestV3(item.request), true);
    assert.equal(isSupplierResultV3(item.result, item.request), true);
  });
}
test('actual supplied-2027 hold and untagged NH/RI retain no named notice collection', () => {
  for (const id of ['nv_supplied_final_2027_held', 'nh_untagged', 'ri_review_action_untagged']) {
    const item = fixture.cases.find(row => row.id === id);
    assert.equal(Object.hasOwn(item.result.preliminary_notice, 'notice_duties'), false);
  }
});

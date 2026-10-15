import test from 'node:test';
import assert from 'node:assert/strict';
import {COFFEE_RESOLUTION_COMPATIBILITY_QUERY,parseAdrEvidence} from '../src/server/coffee-resolution.ts';
const sha='a'.repeat(40);
test('technical decisions require an immutable ADR in the assigned repository',()=>{
 assert.equal(parseAdrEvidence('https://github.com/owner/repo/blob/'+sha+'/docs/adr/001-decision.md','owner/repo').sha,sha);
 for(const url of ['https://github.com/owner/other/blob/'+sha+'/docs/adr/001.md','https://github.com/owner/repo/blob/main/docs/adr/001.md',
  'https://github.com/owner/repo/blob/'+sha+'/src/file.ts','https://github.com/owner/repo/blob/'+sha+'/docs/adr/001.md?token=secret'])
  assert.throws(()=>parseAdrEvidence(url,'owner/repo'));
});

test('ADR acceptance rechecks every compatibility boundary before unblocking',()=>{
 for(const gate of ['registry_prerequisites_satisfied','jsonb_array_elements_text(w.depends_on)','owner_action_dependents','compatibility_dependencies'])
  assert.equal(COFFEE_RESOLUTION_COMPATIBILITY_QUERY.includes(gate),true);
 assert.match(COFFEE_RESOLUTION_COMPATIBILITY_QUERY,/state NOT IN \('MERGED','ACCEPTED'\)/);
});

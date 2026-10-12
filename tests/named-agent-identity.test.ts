import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { authenticateAgent, InvalidAgentCredential, digestCredential } from "../src/server/agent-auth.ts";
import { isApprovedAgentName, requireApprovedAgentName, UnapprovedAgentName, approvedAgentNameCount } from "../src/domain/agent-names.ts";

const pepper = "BoardroomNameTestPepperLongerThanThirtyTwoCharacters";
const token = "Smith_0123456789012345678901234567890123456789";

test("owner names are exact, not normalized or self-asserted", () => {
  assert.ok(approvedAgentNameCount() >= 601);
  assert.equal(requireApprovedAgentName("Smith"),"Smith");
  assert.ok(isApprovedAgentName("Eve"));
  assert.ok(isApprovedAgentName("EVE"));
  assert.ok(isApprovedAgentName("MAX"));
  assert.ok(isApprovedAgentName("Max"));
  assert.ok(!isApprovedAgentName("smith"));
  assert.ok(!isApprovedAgentName(" Smith "));
  assert.throws(()=>requireApprovedAgentName("ChatGPT bot 1"),UnapprovedAgentName);
});

test("credentials, not name claims, authenticate persistent named identity", async () => {
  const previous=process.env.BOARDROOM_TOKEN_PEPPER;
  process.env.BOARDROOM_TOKEN_PEPPER=pepper;
  try {
    let queried=0;
    const db={query:async (_sql:string, values:unknown[])=>{
      queried++;
      assert.equal(values[0],digestCredential(token,pepper));
      return {rowCount:1,rows:[{credential_id:"name-id",label:"Smith",provider:"chatgpt"}]};
    }} as unknown as Pool;
    const headers=new Headers({authorization:`Bearer ${token}`});
    const first=await authenticateAgent(headers,db);
    const second=await authenticateAgent(headers,db);
    assert.deepEqual(first,{credentialId:"name-id",label:"Smith",provider:"chatgpt"});
    assert.equal(second.label,"Smith");
    assert.equal(queried,2);
  } finally {
    if (previous === undefined) delete process.env.BOARDROOM_TOKEN_PEPPER;
    else process.env.BOARDROOM_TOKEN_PEPPER=previous;
  }
});

test("credential for unapproved agent label is rejected",async()=>{
  const previous=process.env.BOARDROOM_TOKEN_PEPPER;
  process.env.BOARDROOM_TOKEN_PEPPER=pepper;
  try {
    const db={query:async()=>({rowCount:1,rows:[{credential_id:"bad-id",label:"Agent 1",provider:"chatgpt"}]})} as unknown as Pool;
    await assert.rejects(authenticateAgent(new Headers({authorization:`Bearer ${token}`}),db),InvalidAgentCredential);
  } finally {
    if (previous === undefined) delete process.env.BOARDROOM_TOKEN_PEPPER;
    else process.env.BOARDROOM_TOKEN_PEPPER=previous;
  }
});

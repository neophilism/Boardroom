import test from "node:test";
import assert from "node:assert/strict";
import {normalizeCoffeeResumeSignal} from "../src/server/assignment-context.ts";

const threadId="7d54a632-94aa-4a9b-b84f-58ebaa0c7208";
const messageId="62ef1e85-af97-4a21-ae7d-6f1bbfd974db";
const sha="a".repeat(40);
const acceptedAt=new Date("2026-10-15T10:48:00Z");

test("accepted Coffee answers produce a repository-scoped resume signal",()=>{
  const signal=normalizeCoffeeResumeSignal("neophilism/Boardroom","BR-048",{
    threadId,messageId,adr:`https://github.com/neophilism/Boardroom/blob/${sha}/docs/adr/048-unblock.md`,acceptedAt
  });
  assert.deepEqual(signal,{
    unitId:"BR-048",threadId,messageId,
    adr:`https://github.com/neophilism/Boardroom/blob/${sha}/docs/adr/048-unblock.md`,
    acceptedAt:"2026-10-15T10:48:00.000Z"
  });
});

test("resume signals fail closed on malformed IDs and cross-repository ADRs",()=>{
  const valid={threadId,messageId,adr:`https://github.com/neophilism/Boardroom/blob/${sha}/docs/adr/048-unblock.md`,acceptedAt};
  assert.equal(normalizeCoffeeResumeSignal("neophilism/Boardroom","BR-048",{...valid,threadId:"bad"}),null);
  assert.equal(normalizeCoffeeResumeSignal("neophilism/Other","BR-048",valid),null);
  assert.equal(normalizeCoffeeResumeSignal("neophilism/Boardroom","BR-048",{...valid,acceptedAt:new Date("invalid")}),null);
});

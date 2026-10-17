import test from "node:test";
import assert from "node:assert/strict";
import {parseCoffeeModeration,CoffeeModerationError} from "../src/server/coffee-moderation.ts";
import {validateAgentTool,AgentToolError} from "../src/server/agent-tools.ts";
const threadId="4b894f54-9e46-45b6-894f-0bb680b08bcb",messageId="67733eef-8ffb-4b6a-b33d-96e24a1f8ac1";
test("retention configuration is bounded and enabling requires explicit consent",()=>{
  assert.deepEqual(parseCoffeeModeration({kind:"retention-policy",enabled:false,retentionDays:180}),
    {kind:"retention-policy",enabled:false,retentionDays:180,confirm:false});
  for(const retentionDays of [30,3650])assert.equal(
    parseCoffeeModeration({kind:"retention-policy",enabled:true,retentionDays,confirm:true}).kind,"retention-policy");
  for(const retentionDays of [0,29,3651,1.5,"180",NaN])assert.throws(
    ()=>parseCoffeeModeration({kind:"retention-policy",enabled:true,retentionDays,confirm:true}),CoffeeModerationError);
  assert.throws(()=>parseCoffeeModeration({kind:"retention-policy",enabled:true,retentionDays:180}),CoffeeModerationError);
});
test("moderation never accepts free-form content or a missing confirmation as a reason",()=>{
  const value={kind:"redact-message",threadId,messageId,reason:"PRIVACY",confirm:true};
  assert.equal(parseCoffeeModeration(value).kind,"redact-message");
  for(const patch of [{reason:"arbitrary text"},{confirm:false},{threadId:"invalid"},{messageId:"invalid"},{kind:"elevate"}])
    assert.throws(()=>parseCoffeeModeration({...value,...patch}),CoffeeModerationError);
  assert.throws(()=>parseCoffeeModeration({kind:"purge"}),CoffeeModerationError);
});
test("discussion text cannot install owner moderation or retention tools",()=>{
  for(const name of ["boardroom_coffee_moderate","boardroom_retention_policy","owner_coffee"])
    assert.throws(()=>validateAgentTool(name,{threadId,messageId,confirm:true}),AgentToolError);
});

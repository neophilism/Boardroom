import test from "node:test";
import assert from "node:assert/strict";
import {claimOwnerActionNotificationBatch,deliverOwnerActionNotifications} from "../src/server/owner-action-notifications.ts";

const now=new Date("2026-10-15T12:00:00Z"),actionId="7d54a632-94aa-4a9b-b84f-58ebaa0c7208";
function database(){
  const calls:{sql:string;params?:unknown[]}[]=[];
  const query=async(sql:string,params?:unknown[])=>{
    calls.push({sql,params});
    if(sql.startsWith("SELECT a.action_id"))return {rowCount:1,rows:[{
      actionId,type:"CREDENTIAL",status:"OPEN",createdAt:new Date("2026-10-13T12:00:00Z"),lastDeliveredAt:null,lastReservedAt:null
    }]};
    return {rowCount:1,rows:[]};
  };
  return {db:{query,connect:async()=>({query,release:()=>{}})},calls};
}

test("claims a concurrency-fenced batch and audits only bounded references",async()=>{
  const fixture=database();
  const batch=await claimOwnerActionNotificationBatch(fixture.db as never,"https://boardroom.example",now);
  assert.deepEqual(batch?.actionIds,[actionId]);
  assert.ok(fixture.calls.some(call=>call.sql.includes("pg_advisory_xact_lock")));
  const reservation=fixture.calls.find(call=>call.sql.includes("notification_reserved"));
  assert.match(String(reservation?.params?.[0]),new RegExp(actionId));
  assert.equal(String(reservation?.params?.[0]).includes("CREDENTIAL"),false);
});

test("delivers one consolidated redacted message and records provider evidence",async()=>{
  const fixture=database();let messages=0;
  const result=await deliverOwnerActionNotifications(fixture.db as never,{send:async message=>{
    messages++;assert.match(message.subject,/1 owner action/);
    assert.equal(message.text.includes("token="),false);
    return {deliveryId:"mail-provider:delivery-17"};
  }},"https://boardroom.example",now);
  assert.equal(messages,1);assert.equal(result?.actionCount,1);
  assert.ok(fixture.calls.some(call=>call.sql.includes("notification_delivered")&&String(call.params?.[0]).includes("mail-provider:delivery-17")));
});

test("failed providers create a secret-free failure audit and preserve retryability",async()=>{
  const fixture=database();
  await assert.rejects(deliverOwnerActionNotifications(fixture.db as never,{send:async()=>{throw new Error("provider response with private material")}},"https://boardroom.example",now));
  const failure=fixture.calls.find(call=>call.sql.includes("notification_failed"));
  assert.ok(failure);assert.equal(String(failure?.params?.[0]).includes("private material"),false);
});

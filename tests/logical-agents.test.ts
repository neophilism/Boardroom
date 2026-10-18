import test from "node:test";
import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {newLogicalAgentId,validLogicalAgentId,parseLogicalAgentInput,LogicalAgentInvalid,
  createLogicalAgent,listLogicalAgents} from "../src/server/logical-agents.ts";

test("ULID identity is sortable and cryptographically randomized, not an auth credential",()=>{
  const zero=newLogicalAgentId(0,new Uint8Array(10));
  const max=newLogicalAgentId(281474976710655,new Uint8Array(10).fill(255));
  assert.equal(zero,"0".repeat(26));
  assert.ok(max.startsWith("7ZZZZZZZZZ"));
  assert.ok(zero<max);
  assert.equal(newLogicalAgentId(1000,new Uint8Array(10).fill(1)),newLogicalAgentId(1000,new Uint8Array(10).fill(1)));
  assert.ok(validLogicalAgentId(newLogicalAgentId()));
  assert.ok(!validLogicalAgentId("../credential"));
  assert.ok(!validLogicalAgentId("I".repeat(26)));
  assert.throws(()=>newLogicalAgentId(-1),LogicalAgentInvalid);
  assert.throws(()=>newLogicalAgentId(1,new Uint8Array(9)),LogicalAgentInvalid);
});
test("10,000 simulated identities do not collide or require provider credentials",()=>{
  const ids=new Set(Array.from({length:10000},()=>newLogicalAgentId()));
  assert.equal(ids.size,10000);
});
test("owner accepts role-specific agents but rejects fabricated authority and unsafe labels",()=>{
  assert.deepEqual(parseLogicalAgentInput({displayName:"Ada",role:"mission",teamKey:"vision",capabilityLabels:["research:policy"]}),
    {displayName:"Ada",role:"mission",teamKey:"vision",capabilityLabels:["research:policy"]});
  assert.equal(parseLogicalAgentInput({displayName:"Worker"}).role,"development");
  for(const bad of [null,[],{}, {displayName:" x"},{displayName:"hi",agentId:"fixed"},
    {displayName:"x",capabilityLabels:["tool:write","tool:write"]},
    {displayName:"x",capabilityLabels:["../admin"]},
    {displayName:"x",role:"root"}, {displayName:"x",teamKey:"../../"},
    {displayName:"x",enabled:true},{displayName:"x",apiKey:"secret"}])
    assert.throws(()=>parseLogicalAgentInput(bad),LogicalAgentInvalid);
});
test("new agents are dormant and SQL creates neither a credential nor a paid session",async()=>{
  const queries:{sql:string;args:unknown[]}[]=[];
  const client={query:async(sql:string,args:unknown[]=[])=>{
    queries.push({sql,args});
    if(sql.includes("INSERT INTO logical_agents"))return {rowCount:1,rows:[{
      agent_id:args[0],display_name:args[2],role:args[3],team_key:args[1],
      capability_labels:JSON.parse(args[4] as string),state:"DORMANT",created_at:new Date("2026-10-18T00:00:00Z")
    }]};
    return {rows:[],rowCount:0};
  },release:()=>{}} as unknown as PoolClient;
  const db={connect:async()=>client} as unknown as Pool;
  const agent=await createLogicalAgent(db,{displayName:"Nova",role:"sales"});
  assert.equal(agent.state,"DORMANT");
  assert.equal(agent.role,"sales");
  assert.ok(validLogicalAgentId(agent.agentId));
  assert.ok(!JSON.stringify(queries).includes("sk-"));
  assert.ok(queries.every(x=>!x.sql.includes("agent_credentials")&&!x.sql.includes("agent_runs")));
  assert.ok(queries.some(x=>x.sql==="COMMIT"));
});
test("keyset pagination is bounded and cannot enumerate arbitrary tenant scopes",async()=>{
  const rows=Array.from({length:3},(_,i)=>({
    agent_id:newLogicalAgentId(i+1,new Uint8Array(10)),display_name:"Agent "+i,
    role:"research",team_key:"general",capability_labels:[],state:"DORMANT",created_at:new Date()
  }));
  const calls:{sql:string;args:unknown[]}[]=[];
  const db={query:async(sql:string,args:unknown[])=>{calls.push({sql,args});return {rows};}} as unknown as Pool;
  const result=await listLogicalAgents(db,null,2);
  assert.equal(result.agents.length,2);
  assert.equal(result.nextCursor,rows[1].agent_id);
  assert.deepEqual(calls[0].args,[null,3]);
  assert.match(calls[0].sql,/scope_key='primary'/);
  assert.match(calls[0].sql,/ORDER BY agent_id ASC LIMIT/);
  await assert.rejects(listLogicalAgents(db,"invalid",2),LogicalAgentInvalid);
  await assert.rejects(listLogicalAgents(db,null,101),LogicalAgentInvalid);
});

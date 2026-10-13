import test from "node:test";
import assert from "node:assert/strict";
import {BoardroomAgentClient,BoardroomRequestError,BoardroomContractError} from "../src/sdk/boardroom-agent-client.ts";

const secret="private_1234567890123456789012345678901234567890";
type Saved={url:string;init:RequestInit};
function fake(responses:Array<{status:number;value:unknown}>){
  const requests:Saved[]=[];
  let cursor=0;
  const transport=async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(!init)throw new Error("Missing request options");
    requests.push({url:String(input),init});
    const r=responses[cursor++];
    if(!r)throw new Error("Unexpected request");
    return new Response(JSON.stringify(r.value),{status:r.status,
      headers:{"Content-Type":"application/json"}});
  };
  return {requests,transport:transport as typeof fetch};
}
test("rejects insecure origins, userinfo and invalid credentials",()=>{
  assert.throws(()=>new BoardroomAgentClient({baseUrl:"http://boardroom.example",bearerToken:secret,assignedName:"Smith"}),BoardroomContractError);
  assert.throws(()=>new BoardroomAgentClient({baseUrl:"https://someone:pass@boardroom.example",bearerToken:secret,assignedName:"Smith"}),BoardroomContractError);
  assert.throws(()=>new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:"short",assignedName:"Smith"}),BoardroomContractError);
});
test("arrival sends the stored opaque credential and checks server-verified identity",async()=>{
  const f=fake([{status:201,value:{agentName:"Smith",provider:"chatgpt",
    runId:"26741e83-9694-4fb3-8174-783b2f9bf61c",shouldWork:true,state:"ADMITTED",replay:false}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  const result=await client.arrive("Smith-activation-2026-10-12T1600");
  assert.equal(result.shouldWork,true);
  const request=f.requests[0];
  assert.equal(request.url,"https://boardroom.example/api/v1/runs/arrive");
  assert.equal(new Headers(request.init.headers).get("Authorization"),"Bearer "+secret);
  assert.equal(new Headers(request.init.headers).get("X-Boardroom-Agent-Name"),"Smith");
  assert.equal(new Headers(request.init.headers).get("Idempotency-Key"),"Smith-activation-2026-10-12T1600");
  assert.equal(request.init.redirect,"error");
});
test("a mismatched server principal fails closed",async()=>{
  const f=fake([{status:201,value:{agentName:"Other",provider:"chatgpt",runId:"uuid",shouldWork:true}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  await assert.rejects(client.arrive(),BoardroomContractError);
});
test("HTTP errors report status without leaking the bearer secret",async()=>{
  const f=fake([{status:401,value:{error:"Unauthorized"}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  await assert.rejects(client.arrive(),e=>{
    assert.ok(e instanceof BoardroomRequestError);
    assert.equal(e.status,401);
    assert.ok(!e.message.includes(secret));
    return true;
  });
});
test("privileged writes are sent once and do not retry on network or conflict errors",async()=>{
  const f=fake([{status:409,value:{error:"GitHub source file conflict"}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  await assert.rejects(client.githubWrite("r","1",{kind:"ensure_branch"}),BoardroomRequestError);
  assert.equal(f.requests.length,1);
  assert.deepEqual(JSON.parse(f.requests[0].init.body as string),{
    runId:"r",generation:"1",kind:"ensure_branch"
  });
});
test("idle finish and Coffee Corner answers use authenticated paths",async()=>{
  const f=fake([
    {status:200,value:{threads:[]}},
    {status:200,value:{state:"YIELDED",replay:false}}
  ]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  assert.deepEqual((await client.coffeeThreads("OPEN")).threads,[]);
  assert.deepEqual(await client.finishIdle("26741e83-9694-4fb3-8174-783b2f9bf61c"),{state:"YIELDED",replay:false});
  assert.ok(f.requests[0].url.endsWith("/api/v1/coffee/threads?status=OPEN"));
  assert.ok(f.requests[1].url.endsWith("/idle"));
});
test("Coffee text filters are encoded without overriding state or authority",async()=>{
  const f=fake([{status:200,value:{threads:[]}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  await client.coffeeThreads("RESOLVED","API & status=OPEN %_");
  const url=new URL(f.requests[0].url);
  assert.equal(url.searchParams.get("status"),"RESOLVED");
  assert.equal(url.searchParams.get("q"),"API & status=OPEN %_");
});

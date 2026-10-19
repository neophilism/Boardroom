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

test("Coffee questions carry blocker classification and optional deadline",async()=>{
  const f=fake([{status:201,value:{threadId:"fixture",status:"OPEN"}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  await client.askCoffee("run","Which database API failed?","The database integration test fails after migration.",[],"1","TEST_FAILURE","2026-10-16T10:00:00Z");
  assert.deepEqual(JSON.parse(String(f.requests[0].init.body)),{runId:"run",subject:"Which database API failed?",question:"The database integration test fails after migration.",evidence:[],classification:"TEST_FAILURE",generation:"1",deadlineAt:"2026-10-16T10:00:00Z"});
});

test("Coffee answers carry source evidence and uncertainty",async()=>{
  const f=fake([{status:201,value:{messageId:"fixture",status:"ANSWERED_UNVERIFIED"}}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  await client.answerCoffee("run","thread","The repository API fix is documented.",
    ["https://github.com/neophilism/Boardroom/pull/92"],"The production database has not been inspected.");
  assert.deepEqual(JSON.parse(String(f.requests[0].init.body)),{
    runId:"run",answer:"The repository API fix is documented.",
    evidence:["https://github.com/neophilism/Boardroom/pull/92"],
    uncertainty:"The production database has not been inspected."
  });
});

test("yield-and-claim keeps current run and requests next assignment with fenced generation",async()=>{
  const expected={status:"ASSIGNED",assignment:{assignmentId:"next",repositoryId:"2",fullName:"ci/next",unitId:"N-002",generation:"7",expiresAt:"2026-10-18T21:00:00Z",replay:false}};
  const f=fake([{status:200,value:expected}]);
  const client=new BoardroomAgentClient({baseUrl:"https://boardroom.example",bearerToken:secret,assignedName:"Smith",transport:f.transport});
  assert.deepEqual(await client.yieldAndClaim("run","6","BLOCKED"),expected);
  assert.ok(f.requests[0].url.endsWith("/api/v1/assignments/yield-and-claim"));
  assert.deepEqual(JSON.parse(f.requests[0].init.body as string),{runId:"run",generation:"6",outcome:"BLOCKED"});
  assert.equal(f.requests.length,1);
});

test("fixed continuation and uncertainty codes survive HTTP without arbitrary response data or retry",async()=>{
  for(const code of ['GITHUB_OPERATION_UNCERTAIN','RELEASE_RECONCILIATION_REQUIRED','CONTINUATION_REQUIRED','private-not-a-code']){
    const f=fake([{status:409,value:{code,error:secret}}]);
    const client=new BoardroomAgentClient({baseUrl:'https://boardroom.example',bearerToken:secret,assignedName:'Smith',transport:f.transport});
    await assert.rejects(client.githubWrite('run','1',{kind:'ensure_branch'}),error=>{
      assert.ok(error instanceof BoardroomRequestError);
      assert.equal(error.code,code==='private-not-a-code'?null:code);
      assert.ok(!error.message.includes(secret));return true;
    });
    assert.equal(f.requests.length,1);
  }
});

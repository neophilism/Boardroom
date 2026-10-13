import test from "node:test";
import assert from "node:assert/strict";
import {verifyAgentInterface} from "../src/server/agent-interface-smoke.ts";
const base="https://boardroom.example";
function fixture(oauth:boolean,broken?:"anonymous"|"resource"|"issuer"|"tools"|"challenge"|"discovery"){
  const calls:{path:string;body:Record<string,unknown>|null}[]=[];
  const request=async(path:string,options?:RequestInit)=>{
    const body=options?.body?JSON.parse(String(options.body)):null;calls.push({path,body});
    if(path==="/api/mcp"){
      if(body.method==="initialize")return Response.json({result:{serverInfo:{name:"boardroom"},protocolVersion:"2025-11-25"}});
      if(body.method==="tools/list")return Response.json({result:{tools:broken==="tools"?[]:
        ["boardroom_profile","boardroom_arrive","boardroom_claim","boardroom_source","boardroom_write","boardroom_checkpoint","boardroom_finish"].map(name=>({name}))}});
      assert.equal(body.method,"tools/call");assert.equal(body.params.name,"boardroom_profile");
      return Response.json({error:"Unauthorized"},{status:broken==="anonymous"?200:401,headers:oauth&&broken!=="challenge"?{"WWW-Authenticate":'Bearer resource_metadata="'+base+'/.well-known/oauth-protected-resource"'}:{}});
    }
    if(path==="/.well-known/oauth-protected-resource")return Response.json({resource:(broken==="resource"?"https://wrong.example":base)+"/api/mcp",authorization_servers:[base]},
      {status:broken==="discovery"?503:oauth?200:404});
    if(path==="/.well-known/oauth-authorization-server")return Response.json({issuer:broken==="issuer"?"https://wrong.example":base,
      authorization_endpoint:base+"/oauth/authorize",token_endpoint:base+"/oauth/token",code_challenge_methods_supported:["S256"]});
    throw new Error("Unexpected public interface probe");
  };
  return {calls,request};
}
test("live release probes report enabled or disabled OAuth without activating an agent",async()=>{
  for(const enabled of [true,false]){
    const f=fixture(enabled);assert.equal(await verifyAgentInterface(base,f.request),enabled?"ENABLED":"DISABLED");
    assert.deepEqual(f.calls.filter(c=>c.body?.method==="tools/call").map(c=>c.body?.params),[{name:"boardroom_profile",arguments:{}}]);
  }
});
test("broken discovery, anonymous access and incorrect OAuth endpoints fail release verification",async()=>{
  for(const broken of ["anonymous","resource","issuer","tools","challenge","discovery"] as const)
    await assert.rejects(verifyAgentInterface(base,fixture(true,broken).request));
});

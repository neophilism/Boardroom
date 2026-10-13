import assert from "node:assert/strict";

/** Public read-only interface probes. No session, grant or write is created. */
export async function verifyAgentInterface(base:string,request:(path:string,options?:RequestInit)=>Promise<Response>):Promise<"ENABLED"|"DISABLED">{
  const rpc=async(body:Record<string,unknown>)=>request("/api/mcp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const initialize=await rpc({jsonrpc:"2.0",id:"release-init",method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"boardroom-release-smoke",version:"1"}}});
  assert.equal(initialize.status,200,"MCP initialization must be reachable");
  const init=await initialize.json();
  assert.equal(init.result?.serverInfo?.name,"boardroom","MCP must identify Boardroom");
  assert.equal(init.result?.protocolVersion,"2025-11-25","MCP must negotiate the supported release protocol");
  const catalog=await rpc({jsonrpc:"2.0",id:"release-tools",method:"tools/list"});
  assert.equal(catalog.status,200,"Public MCP tool discovery must be reachable");
  const definitions=(await catalog.json()).result?.tools;
  assert.ok(Array.isArray(definitions),"MCP tools must be a valid catalog");
  for(const name of ["boardroom_profile","boardroom_arrive","boardroom_claim","boardroom_source","boardroom_write","boardroom_checkpoint","boardroom_finish"])
    assert.ok(definitions.some((tool:{name?:string})=>tool.name===name),"Required MCP operation missing: "+name);
  const anonymous=await rpc({jsonrpc:"2.0",id:"release-denial",method:"tools/call",params:{name:"boardroom_profile",arguments:{}}});
  assert.equal(anonymous.status,401,"Anonymous operational tool calls must be denied");
  const resource=await request("/.well-known/oauth-protected-resource");
  if(resource.status===200){
    const metadata=await resource.json();
    assert.equal(metadata.resource,base+"/api/mcp","OAuth resource must bind the actual Boardroom endpoint");
    assert.deepEqual(metadata.authorization_servers,[base],"OAuth issuer must be the existing Boardroom origin");
    assert.ok(anonymous.headers.get("www-authenticate")?.includes(base+"/.well-known/oauth-protected-resource"),"Enabled OAuth must provide the discovery challenge");
    const issuer=await request("/.well-known/oauth-authorization-server");
    assert.equal(issuer.status,200,"Enabled OAuth issuer discovery must be available");
    const authorization=await issuer.json();
    assert.equal(authorization.issuer,base);
    assert.equal(authorization.authorization_endpoint,base+"/oauth/authorize");
    assert.equal(authorization.token_endpoint,base+"/oauth/token");
    assert.ok(authorization.code_challenge_methods_supported?.includes("S256"));
    return "ENABLED";
  }else{
    assert.equal(resource.status,404,"OAuth discovery must be valid or explicitly disabled");
    return "DISABLED";
  }
}

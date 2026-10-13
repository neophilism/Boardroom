import test from "node:test";
import assert from "node:assert/strict";
import {parseMcpRequest,McpRequestError} from "../src/server/mcp-request.ts";
test("MCP request parser distinguishes malformed JSON, envelopes and params",()=>{
  for(const [raw,code] of [["{",-32700],["null",-32600],["[]",-32600],['{"method":"ping"}',-32600],
    ['{"jsonrpc":"2.0","id":{},"method":"ping"}',-32600],
    ['{"jsonrpc":"2.0","id":3,"method":"tools/call","params":[]}',-32602]] as const)
    assert.throws(()=>parseMcpRequest(raw),(e:unknown)=>e instanceof McpRequestError&&e.code===code);
});
test("operational notifications cannot cause unacknowledged writes",()=>{
  assert.throws(()=>parseMcpRequest(JSON.stringify({jsonrpc:"2.0",method:"tools/call",params:{name:"boardroom_arrive"}})),McpRequestError);
  assert.equal(parseMcpRequest('{"jsonrpc":"2.0","method":"notifications/initialized"}').id,undefined);
});
test("ordinary calls retain response IDs and safe errors never echo invalid payloads",()=>{
  for(const id of [0,7,"request-1",null])assert.equal(parseMcpRequest(JSON.stringify({jsonrpc:"2.0",id,method:"ping"})).id,id);
  assert.throws(()=>parseMcpRequest('{"jsonrpc":"2.0","id":"req","method":"ping","params":"secret"}'),
    (e:unknown)=>e instanceof McpRequestError&&e.requestId==="req"&&!e.message.includes("secret"));
});

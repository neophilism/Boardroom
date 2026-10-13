import test from "node:test";
import assert from "node:assert/strict";
import {boundedRequestText,RequestBodyTooLarge} from "../src/server/request-body.ts";
test("bounded readers count bytes, not characters",async()=>{
  assert.equal(await boundedRequestText(new Request("https://boardroom.example",{method:"POST",body:"é"}),2),"é");
  await assert.rejects(boundedRequestText(new Request("https://boardroom.example",{method:"POST",body:"é"}),1),RequestBodyTooLarge);
});
test("declared oversized requests are rejected before their stream is read",async()=>{
  await assert.rejects(boundedRequestText(new Request("https://boardroom.example",{method:"POST",headers:{"content-length":"1000"},body:"small"}),10),RequestBodyTooLarge);
});
test("streaming without a content length stops and cancels at the boundary",async()=>{
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(6));},cancel(){cancelled=true;}});
  const request=new Request("https://boardroom.example",{method:"POST",body:stream,duplex:"half"} as RequestInit);
  await assert.rejects(boundedRequestText(request,10),RequestBodyTooLarge);assert.equal(cancelled,true);
});

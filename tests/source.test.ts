import test from "node:test";
import assert from "node:assert/strict";
import {readableSourcePath} from "../src/server/source.ts";
import {SessionConflict} from "../src/server/sessions.ts";
test("workers can read instructions and example config, but not secrets or traversal",()=>{
  for(const p of ["AGENTS.md",".env.example","registry/roadmap.json","src/index.ts"])
    assert.equal(readableSourcePath(p),p);
  for(const p of ["../keys",".env.local",".ENV.production",".EnV",".npmrc","src/.pypirc",".ssh/key","secrets/api.txt","cert.pem","src//index.ts","a\\b"])
    assert.throws(()=>readableSourcePath(p),SessionConflict);
});

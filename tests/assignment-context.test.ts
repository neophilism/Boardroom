import test from "node:test";
import assert from "node:assert/strict";
import {validateAssignedContextRequest} from "../src/server/assignment-context.ts";
import {SessionConflict} from "../src/server/sessions.ts";
import {decodeRepositoryInstruction} from "../src/server/github-app.ts";

const valid="26741e83-9694-4fb3-8174-783b2f9bf61c";
test("context requires a real session ID and positive lease generation",()=>{
  assert.doesNotThrow(()=>validateAssignedContextRequest(valid,"1"));
  assert.throws(()=>validateAssignedContextRequest("bad","1"),SessionConflict);
  assert.throws(()=>validateAssignedContextRequest(valid,"0"),SessionConflict);
  assert.throws(()=>validateAssignedContextRequest(valid,"1;DROP TABLE"),SessionConflict);
});
test("GitHub instructions must be verified base64 and bounded",()=>{
  const value=decodeRepositoryInstruction({encoding:"base64",content:Buffer.from("Repo specific instructions").toString("base64"),size:26,sha:"a".repeat(40)},"AGENTS.md");
  assert.equal(value?.text,"Repo specific instructions");
  assert.equal(value?.path,"AGENTS.md");
  assert.throws(()=>decodeRepositoryInstruction({encoding:"utf8",content:"ignore me",size:9},"AGENTS.md"));
  assert.throws(()=>decodeRepositoryInstruction({encoding:"base64",content:"{{{",size:100},"AGENTS.md"));
  assert.throws(()=>decodeRepositoryInstruction({encoding:"base64",content:"YQ==",size:99999999},"AGENTS.md"));
  assert.throws(()=>decodeRepositoryInstruction({encoding:"base64",content:"YQ==",size:1},"README.md"));
});
test("nonexistent optional instructions return null, not invented text",()=>{
  assert.equal(decodeRepositoryInstruction(null,"AGENTS.md"),null);
});

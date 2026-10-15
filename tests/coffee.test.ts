import test from "node:test";
import assert from "node:assert/strict";
import {validateCoffeeText,validateEvidence,normalizeCoffeeQuestionMetadata,CoffeeError} from "../src/server/coffee.ts";
test("only work-related English content can enter Coffee Corner",()=>{
  assert.equal(validateCoffeeText("How should this repository API enforce authorization?"),"How should this repository API enforce authorization?");
  assert.throws(()=>validateCoffeeText("What did you have for breakfast?"),CoffeeError);
  assert.throws(()=>validateCoffeeText("sk-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKG is our API secret"),CoffeeError);
  assert.throws(()=>validateCoffeeText("My SSN is 123-45-6789; fix this code"),CoffeeError);
});
test("answers require valid Github evidence URL references",()=>{
  assert.deepEqual(validateEvidence(["https://github.com/neophilism/Boardroom/pull/8"]),["https://github.com/neophilism/Boardroom/pull/8"]);
  assert.throws(()=>validateEvidence(["http://example.com"]),CoffeeError);
  assert.throws(()=>validateEvidence(["https://evil.com/steal"]),CoffeeError);
});

test("question metadata keeps technical blockers asynchronous and time bounded",()=>{
  const now=new Date("2026-10-15T10:00:00.000Z");
  assert.deepEqual(normalizeCoffeeQuestionMetadata("DEPENDENCY","2026-10-16T10:00:00Z",now),{classification:"DEPENDENCY",deadlineAt:"2026-10-16T10:00:00.000Z"});
  assert.deepEqual(normalizeCoffeeQuestionMetadata(undefined,undefined,now),{classification:"TECHNICAL",deadlineAt:null});
  assert.throws(()=>normalizeCoffeeQuestionMetadata("OWNER_APPROVAL",null,now),CoffeeError);
  assert.throws(()=>normalizeCoffeeQuestionMetadata("TECHNICAL","2026-10-15T09:59:59Z",now),CoffeeError);
  assert.throws(()=>normalizeCoffeeQuestionMetadata("TECHNICAL","2028-10-15T10:00:00Z",now),CoffeeError);
});

import test from "node:test";
import assert from "node:assert/strict";
import {validateCoffeeText,validateEvidence,CoffeeError} from "../src/server/coffee.ts";
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

import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {parseGitHubPrivateKey,GitHubAppSetupFailure} from "../src/server/github-app.ts";

const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const pem=privateKey.export({type:"pkcs1",format:"pem"}).toString();
test("RSA PEM survives newlines, CRLF and common secret-manager quoting",()=>{
  for(const value of [pem,pem.replace(/\n/g,"\r\n"),pem.replace(/\n/g,"\\n"),
    '"'+pem.replace(/\n/g,"\\n")+'"',"'"+pem+"'","\uFEFF"+pem])
    assert.equal(parseGitHubPrivateKey(value).asymmetricKeyType,"rsa");
});
test("truncated, wrong-type and public keys fail without returning their values",()=>{
  const ec=generateKeyPairSync("ec",{namedCurve:"prime256v1"}).privateKey.export({type:"pkcs8",format:"pem"}).toString();
  for(const value of [pem.slice(0,80),"not-a-key",ec]){
    assert.throws(()=>parseGitHubPrivateKey(value),error=>{
      assert.ok(error instanceof GitHubAppSetupFailure);
      assert.equal(error.issue,"PRIVATE_KEY_INVALID");
      assert.ok(!error.message.includes(value));return true;
    });
  }
});

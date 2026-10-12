import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createVerify} from "node:crypto";
import {
  normalizeGitHubAppPrivateKey,signGitHubAppJWT,GitHubAppSetupFailure
} from "../src/server/github-app.ts";

const pair=generateKeyPairSync("rsa",{modulusLength:2048});
const rsa=pair.privateKey.export({type:"pkcs1",format:"pem"}).toString();
const pkcs8=pair.privateKey.export({type:"pkcs8",format:"pem"}).toString();

test("accept original unmodified GitHub RSA PEM and PKCS8 PEM",()=>{
  assert.equal(normalizeGitHubAppPrivateKey(rsa).trim(),rsa.trim());
  assert.equal(normalizeGitHubAppPrivateKey(pkcs8).trim(),pkcs8.trim());
});

test("accept escaped newlines, CRLF, and quoted PEM saved in Render",()=>{
  for(const raw of [
    rsa.replace(/\n/g,"\\n"),
    rsa.replace(/\n/g,"\\r\\n"),
    rsa.replace(/\n/g,"\r\n"),
    JSON.stringify(rsa),
    "'"+rsa+"'",
    '"'+rsa+'"',
    "  "+rsa+"  ",
  ]){
    assert.equal(normalizeGitHubAppPrivateKey(raw),rsa,
      "Every common PEM presentation should resolve to the original key");
  }
});

test("a normalized PEM signs a cryptographically verifiable GitHub RS256 JWT",()=>{
  const now=1760300000;
  for(const source of [rsa,pkcs8,JSON.stringify(rsa),rsa.replace(/\n/g,"\\n")]){
    const jwt=signGitHubAppJWT("123456",source,now);
    const [header,payload,sig,...extra]=jwt.split(".");
    assert.equal(extra.length,0);
    const claims=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    assert.deepEqual(JSON.parse(Buffer.from(header,"base64url").toString("utf8")),
      {alg:"RS256",typ:"JWT"});
    assert.deepEqual(claims,{iat:now-60,exp:now+540,iss:"123456"});
    const verifier=createVerify("RSA-SHA256");
    verifier.update(header+"."+payload);
    verifier.end();
    assert.equal(verifier.verify(pair.publicKey,Buffer.from(sig,"base64url")),true);
  }
});

test("missing delimiters, public keys and truncated PEM cannot sign",()=>{
  const publicKey=pair.publicKey.export({type:"spki",format:"pem"}).toString();
  for(const raw of [
    publicKey,
    rsa.slice(10),
    rsa.slice(0,-50),
    "not a key",
    "-----BEGIN PRIVATE KEY-----\nABC!\n-----END PRIVATE KEY-----",
  ]){
    assert.throws(()=>normalizeGitHubAppPrivateKey(raw),e=>
      e instanceof GitHubAppSetupFailure&&e.issue==="PRIVATE_KEY_INVALID");
    assert.throws(()=>signGitHubAppJWT("123456",raw),e=>
      e instanceof GitHubAppSetupFailure&&e.issue==="PRIVATE_KEY_INVALID");
  }
});

test("malformed App ID is reported separately from key problems",()=>{
  assert.throws(()=>signGitHubAppJWT("my-app",rsa),e=>
    e instanceof GitHubAppSetupFailure&&e.issue==="APP_ID_INVALID");
});

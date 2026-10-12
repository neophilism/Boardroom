import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeOwner,authorizeOwnerCredential,UnauthorizedOwner,OwnerConfigurationError
} from "../src/server/owner-auth.ts";

function withOwnerSecret(value:string|undefined,verify:()=>void){
  const before=process.env.BOARDROOM_OWNER_API_TOKEN;
  try{
    if(value===undefined)delete process.env.BOARDROOM_OWNER_API_TOKEN;
    else process.env.BOARDROOM_OWNER_API_TOKEN=value;
    verify();
  }finally{
    if(before===undefined)delete process.env.BOARDROOM_OWNER_API_TOKEN;
    else process.env.BOARDROOM_OWNER_API_TOKEN=before;
  }
}

test("owner credentials with standard base64 punctuation are accepted exactly",()=>{
  const credential="Q7Zk/8mDSNsM+65iaUf3Em==+is-this-correct-valid-password";
  withOwnerSecret(credential,()=>{
    assert.doesNotThrow(()=>authorizeOwnerCredential(credential));
    assert.doesNotThrow(()=>authorizeOwner(new Headers({authorization:"Bearer "+credential})));
  });
});

test("password-manager credentials may contain arbitrary punctuation and spaces",()=>{
  const credential=` a#t:6!d$\"e' (G){I}=?+*/;_~abcdefghijklmnop `;
  withOwnerSecret(credential,()=>{
    assert.doesNotThrow(()=>authorizeOwnerCredential(credential));
    assert.throws(()=>authorizeOwnerCredential(credential.trim()),UnauthorizedOwner);
    assert.throws(()=>authorizeOwnerCredential(credential.replace("#","@")),UnauthorizedOwner);
  });
});

test("credential is compared exactly and never normalized",()=>{
  const credential="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz=+/";
  withOwnerSecret(credential,()=>{
    assert.doesNotThrow(()=>authorizeOwnerCredential(credential));
    assert.throws(()=>authorizeOwnerCredential(" "+credential),UnauthorizedOwner);
    assert.throws(()=>authorizeOwnerCredential(credential+" "),UnauthorizedOwner);
    assert.throws(()=>authorizeOwnerCredential(null),UnauthorizedOwner);
    assert.throws(()=>authorizeOwnerCredential("short"),UnauthorizedOwner);
  });
});

test("missing server credential differs from an incorrect supplied credential",()=>{
  withOwnerSecret(undefined,()=>{
    assert.throws(()=>authorizeOwnerCredential("A".repeat(40)),OwnerConfigurationError);
  });
  withOwnerSecret("too-short",()=>{
    assert.throws(()=>authorizeOwnerCredential("A".repeat(40)),OwnerConfigurationError);
  });
  withOwnerSecret("B".repeat(40),()=>{
    assert.throws(()=>authorizeOwnerCredential("A".repeat(40)),UnauthorizedOwner);
  });
});

test("Bearer header path rejects missing or different secrets",()=>{
  const credential="c#4+y=a53!9/DpR9v0PB8Ts=:Zm_hLMn3+aMU";
  withOwnerSecret(credential,()=>{
    assert.throws(()=>authorizeOwner(new Headers()),UnauthorizedOwner);
    assert.doesNotThrow(()=>authorizeOwner(new Headers({authorization:"Bearer "+credential})));
    assert.throws(()=>authorizeOwner(new Headers({authorization:"Basic "+credential})),UnauthorizedOwner);
  });
});

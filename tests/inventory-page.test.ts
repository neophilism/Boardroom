import test from "node:test";
import assert from "node:assert/strict";
import {inventoryPageOutcome} from "../src/domain/inventory-page.ts";
test("two invalid repositories do not block the next inventory page",()=>{
 const result=inventoryPageOutcome({processed:6,failed:2,nextAfterId:"1414080495",errors:[
   {repository:"neophilism/Superintelligence-Academy",reason:"Unverified plan"},
   {repository:"neophilism/Superintelligence-Command-Center",reason:"Unverified plan"}
 ]});
 assert.deepEqual(result,{partial:true,nextAfterId:"1414080495",
   failedRepositories:["neophilism/Superintelligence-Academy","neophilism/Superintelligence-Command-Center"]});
});
test("complete inventory pages can close without a continuation",()=>{
 assert.deepEqual(inventoryPageOutcome({processed:3,failed:0,nextAfterId:null,errors:[]}),
   {partial:false,nextAfterId:null,failedRepositories:[]});
});
test("an inconsistent or malformed importer report fails closed",()=>{
 for(const report of [
  {processed:1,failed:2,nextAfterId:"10",errors:[]},
  {processed:1,failed:1,nextAfterId:"10",errors:[]},
  {processed:1,failed:0,nextAfterId:"../bad",errors:[]},
  {processed:-1,failed:0,nextAfterId:null,errors:[]}
 ])assert.throws(()=>inventoryPageOutcome(report));
});

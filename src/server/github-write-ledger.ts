import {createHash} from "node:crypto";
import type {GithubWrite} from "./github-write-gateway.ts";

function canonical(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value!==null&&typeof value==="object")return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>JSON.stringify(key)+":"+canonical(item)).join(",")+"}";
  return JSON.stringify(value);
}
/** Hash validated intent only. Source text, tokens and PR bodies are not stored. */
export function githubWriteIdentity(unitId:string,operation:unknown){
  const digest=createHash("sha256").update(canonical({unitId,operation})).digest("hex");
  return {digest,key:"github-write:v1:"+digest};
}

/** Enough immutable scope for a successor to reconcile, without storing code,
 * descriptions, commit messages, credentials or executable request payloads. */
export function githubWriteMetadata(op:GithubWrite){
  if(op.kind==="commit_files")return {kind:op.kind,expectedHeadSha:op.expectedHeadSha,paths:op.files.map(file=>file.path)};
  if(op.kind==="upsert_file")return {kind:op.kind,path:op.path,expectedSha:op.expectedSha};
  if(op.kind==="ready_pr")return {kind:op.kind,number:op.number};
  return {kind:op.kind};
}

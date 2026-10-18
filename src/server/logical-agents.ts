import {randomBytes} from "node:crypto";
import type {Pool} from "pg";

export const LOGICAL_AGENT_ROLES=["development","sales","funding","research","operations","support","mission","other"] as const;
export type LogicalAgentRole=typeof LOGICAL_AGENT_ROLES[number];
const ALPHABET="0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const KEY=/^[a-z][a-z0-9_-]{0,39}$/;
const CAPABILITY=/^[a-z][a-z0-9:_-]{0,63}$/;
export class LogicalAgentInvalid extends Error{
  constructor(message="Invalid logical agent request"){super(message);this.name="LogicalAgentInvalid";}
}
/** Lexicographically sortable 48-bit millisecond timestamp and 80 random bits.
 * IDs are generated server-side; they are NOT authentication credentials.
 */
export function newLogicalAgentId(at=Date.now(),random:Uint8Array=randomBytes(10)):string{
  if(!Number.isSafeInteger(at)||at<0||at>281474976710655||random.length!==10)
    throw new LogicalAgentInvalid("Invalid ULID clock or entropy");
  let time=BigInt(at),suffix=0n;
  for(const byte of random)suffix=(suffix<<8n)|BigInt(byte);
  let a="",b="";
  for(let i=0;i<10;i++){a=ALPHABET[Number(time&31n)]+a;time>>=5n;}
  for(let i=0;i<16;i++){b=ALPHABET[Number(suffix&31n)]+b;suffix>>=5n;}
  return a+b;
}
export function validLogicalAgentId(value:unknown):value is string{
  return typeof value==="string"&&ULID.test(value);
}
export type LogicalAgentInput={displayName:string;role:LogicalAgentRole;teamKey:string;capabilityLabels:string[]};
/** Capability labels are searchable annotations, NEVER executable permissions. */
export function parseLogicalAgentInput(value:unknown):LogicalAgentInput{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new LogicalAgentInvalid();
  const body=value as Record<string,unknown>;
  const allowed=new Set(["displayName","role","teamKey","capabilityLabels"]);
  if(Object.keys(body).some(k=>!allowed.has(k)))throw new LogicalAgentInvalid("Unsupported field (IDs and authority are server-owned)");
  if(typeof body.displayName!=="string"||body.displayName.trim()!==body.displayName||
     body.displayName.length<1||body.displayName.length>100||/[\u0000-\u001f\u007f]/.test(body.displayName))
    throw new LogicalAgentInvalid("Enter a display name (1-100 characters)");
  const role=body.role??"development";
  if(typeof role!=="string"||!LOGICAL_AGENT_ROLES.includes(role as LogicalAgentRole))
    throw new LogicalAgentInvalid("Unsupported logical agent role");
  const teamKey=body.teamKey??"general";
  if(typeof teamKey!=="string"||!KEY.test(teamKey))
    throw new LogicalAgentInvalid("Invalid team key");
  const labels=body.capabilityLabels??[];
  if(!Array.isArray(labels)||labels.length>12||
    labels.some(l=>typeof l!=="string"||!CAPABILITY.test(l))||
    new Set(labels).size!==labels.length)
    throw new LogicalAgentInvalid("Capability labels must be unique safe labels (maximum 12)");
  return {displayName:body.displayName,role:role as LogicalAgentRole,teamKey,capabilityLabels:labels as string[]};
}
export type LogicalAgentRow={
  agentId:string;displayName:string;role:LogicalAgentRole;teamKey:string;
  capabilityLabels:string[];state:"DORMANT"|"PAUSED"|"RETIRED";createdAt:string;
};
function mapRow(row:{agent_id:string;display_name:string;role:LogicalAgentRole;team_key:string;
  capability_labels:string[];state:LogicalAgentRow["state"];created_at:Date}):LogicalAgentRow{
  return {agentId:row.agent_id,displayName:row.display_name,role:row.role,teamKey:row.team_key,
    capabilityLabels:row.capability_labels,state:row.state,createdAt:new Date(row.created_at).toISOString()};
}
type DbAgentRow=Parameters<typeof mapRow>[0];
/** Owner-only entrypoint. Creates metadata in DORMANT state; never provisions keys,
 * starts a schedule, sends a provider call, or enables a tool capability. */
export async function createLogicalAgent(db:Pool,input:unknown){
  const p=parseLogicalAgentInput(input),id=newLogicalAgentId();
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const inserted=await client.query<DbAgentRow>(`INSERT INTO logical_agents
      (agent_id,scope_key,team_key,display_name,role,capability_labels)
      VALUES($1,'primary',$2,$3,$4,$5::jsonb)
      RETURNING agent_id,display_name,role,team_key,capability_labels,state,created_at`,
      [id,p.teamKey,p.displayName,p.role,JSON.stringify(p.capabilityLabels)]);
    if(inserted.rowCount!==1)throw new Error("Logical agent insert did not return one record");
    await client.query("INSERT INTO audit_events(kind,details) VALUES('owner.logical_agent.created',$1::jsonb)",
      [JSON.stringify({agentId:id,role:p.role,teamKey:p.teamKey,initialState:"DORMANT",paidProviderEnabled:false})]);
    await client.query("COMMIT");
    return mapRow(inserted.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function listLogicalAgents(db:Pool,cursor:string|null=null,limit=50){
  if(cursor!==null&&!validLogicalAgentId(cursor))throw new LogicalAgentInvalid("Invalid agent cursor");
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new LogicalAgentInvalid("Invalid page size");
  const result=await db.query<DbAgentRow>(`SELECT agent_id,display_name,role,team_key,capability_labels,state,created_at
    FROM logical_agents WHERE scope_key='primary' AND ($1::varchar IS NULL OR agent_id>$1)
    ORDER BY agent_id ASC LIMIT $2`,[cursor,limit+1]);
  const nextCursor=result.rows.length>limit?result.rows[limit-1].agent_id:null;
  return {agents:result.rows.slice(0,limit).map(mapRow),nextCursor};
}

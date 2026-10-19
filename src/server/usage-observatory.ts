import type {Pool} from "pg";

/**
 * The usage ledger measures only hosted runner calls, at configured token
 * prices. It is NOT a ChatGPT Work credit ledger or a provider invoice.
 * All other statistics below are observations of Boardroom server activity.
 */
export type AgentUsageRow={
  credentialId:string;name:string;provider:string;
  sessions24h:number;sessions7d:number;sessions30d:number;
  completed7d:number;failed7d:number;blocked7d:number;activeNow:number;
  lastSeenAt:string|null;activeRepository:string|null;
  inputTokens24h:number;outputTokens24h:number;
  reportedUsd24h:number;reportedUsd7d:number;reportedUsd30d:number;
  pendingMaximumUsd24h:number;reportedCalls7d:number;
  verifiedMerges7d:number;mergeDenials7d:number;
  completedRuntimeHours7d:number;
  metering:"hosted-reported"|"not-observed";
};
export type FleetDay={day:string;reportedUsd:number;calls:number;sessions:number;verifiedMerges:number};
export type UsageObservatory={observedAt:string;agents:AgentUsageRow[];days:FleetDay[];
  summary:{active:number;recovering:number;sessions24h:number;reportedUsd24h:number;pendingMaximumUsd24h:number;verifiedMerges7d:number;unmeteredAgents:number;outboxPending:number;outboxFailed:number;openOwnerActions:number;lastMaintenanceAt:string|null};
  hostedRollingCapUsd:number|null;
  limitations:string[]};

type DbRow=Record<string,unknown>;
function numberOf(v:unknown):number{
  const n=Number(v??0);
  if(!Number.isFinite(n)||n<0)throw new Error("Invalid usage aggregate");
  return n;
}
function isoOf(v:unknown):string|null{
  if(v===null||v===undefined)return null;
  const d=v instanceof Date?v:new Date(String(v));
  if(!Number.isFinite(d.getTime()))throw new Error("Invalid usage timestamp");
  return d.toISOString();
}
const microUsd=(v:unknown)=>numberOf(v)/1_000_000;
const rowsById=(rows:DbRow[])=>new Map(rows.map(r=>[String(r.credentialId),r]));
const range="now()-interval '30 days'";

/** Bounded grouped queries; no model invocation, paid API call, or per-agent polling. */
export async function getUsageObservatory(db:Pool,env:NodeJS.ProcessEnv=process.env):Promise<UsageObservatory>{
  const [identity,runCounts,current,charges,reservations,github,history,arrivals,merges,health]=await Promise.all([
    db.query<DbRow>(`SELECT credential_id::text AS "credentialId",label AS name,provider
      FROM agent_credentials WHERE enabled=TRUE AND revoked_at IS NULL ORDER BY label,credential_id`),
    db.query<DbRow>(`SELECT credential_id::text AS "credentialId",
      count(*) FILTER(WHERE started_at>=now()-interval '24 hours')::int AS "sessions24h",
      count(*) FILTER(WHERE started_at>=now()-interval '7 days')::int AS "sessions7d",
      count(*)::int AS "sessions30d",
      count(*) FILTER(WHERE state='COMPLETED' AND started_at>=now()-interval '7 days')::int AS "completed7d",
      count(*) FILTER(WHERE state='FAILED' AND started_at>=now()-interval '7 days')::int AS "failed7d",
      count(*) FILTER(WHERE state='BLOCKED' AND started_at>=now()-interval '7 days')::int AS "blocked7d",
      max(last_seen_at) AS "lastSeenAt",
      COALESCE(sum(extract(epoch from ended_at-started_at))
        FILTER(WHERE ended_at IS NOT NULL AND started_at>=now()-interval '7 days'),0)::text AS "durationSeconds7d"
      FROM agent_runs WHERE started_at>=${range} GROUP BY credential_id`),
    db.query<DbRow>(`SELECT ar.credential_id::text AS "credentialId",
      count(*)::int AS "activeNow",
      (array_agg(r.full_name ORDER BY ar.started_at DESC))[1] AS "activeRepository"
      FROM agent_runs ar
      LEFT JOIN work_assignments wa ON wa.run_id=ar.run_id AND wa.released_at IS NULL
      LEFT JOIN repositories r ON r.repository_id=wa.repository_id
      WHERE ar.state='RUNNING'
      GROUP BY ar.credential_id`),
    db.query<DbRow>(`SELECT ar.credential_id::text AS "credentialId",
      COALESCE(sum(ue.input_tokens) FILTER(WHERE ue.created_at>=now()-interval '24 hours'),0)::text AS "inputTokens24h",
      COALESCE(sum(ue.output_tokens) FILTER(WHERE ue.created_at>=now()-interval '24 hours'),0)::text AS "outputTokens24h",
      COALESCE(sum(ue.cost_microusd) FILTER(WHERE ue.created_at>=now()-interval '24 hours'),0)::text AS "reportedMicro24h",
      COALESCE(sum(ue.cost_microusd) FILTER(WHERE ue.created_at>=now()-interval '7 days'),0)::text AS "reportedMicro7d",
      COALESCE(sum(ue.cost_microusd),0)::text AS "reportedMicro30d",
      count(*) FILTER(WHERE ue.created_at>=now()-interval '7 days')::int AS "reportedCalls7d"
      FROM usage_events ue JOIN agent_runs ar ON ar.run_id=ue.run_id
      WHERE ue.created_at>=${range} GROUP BY ar.credential_id`),
    db.query<DbRow>(`SELECT ar.credential_id::text AS "credentialId",
      COALESCE(sum(rb.reserved_microusd) FILTER(WHERE rb.state='RESERVED'),0)::text AS "pendingMicro24h"
      FROM runner_budget_reservations rb JOIN agent_runs ar ON ar.run_id=rb.run_id
      WHERE rb.created_at>=now()-interval '24 hours'
      GROUP BY ar.credential_id`),
    db.query<DbRow>(`SELECT ar.credential_id::text AS "credentialId",
      count(*) FILTER(WHERE ae.kind='github.pr.merged')::int AS "verifiedMerges7d",
      count(*) FILTER(WHERE ae.kind='github.pr.merge_denied')::int AS "mergeDenials7d"
      FROM audit_events ae JOIN agent_runs ar ON ar.run_id=ae.run_id
      WHERE ae.occurred_at>=now()-interval '7 days'
        AND ae.kind IN ('github.pr.merged','github.pr.merge_denied')
      GROUP BY ar.credential_id`),
    db.query<DbRow>(`SELECT to_char(ue.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
      COALESCE(sum(ue.cost_microusd),0)::text AS "microUsd",count(*)::int AS calls
      FROM usage_events ue WHERE ue.created_at>=now()-interval '14 days'
      GROUP BY 1 ORDER BY 1`),
    db.query<DbRow>(`SELECT to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
      count(*)::int AS sessions FROM agent_runs
      WHERE started_at>=now()-interval '14 days' GROUP BY 1`),
    db.query<DbRow>(`SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
      count(*)::int AS merges FROM audit_events
      WHERE occurred_at>=now()-interval '14 days' AND kind='github.pr.merged' GROUP BY 1`),
    db.query<DbRow>(`SELECT
      (SELECT count(*)::int FROM agent_runs WHERE state IN ('RECOVERING','UNKNOWN')) AS "recovering",
      (SELECT count(*)::int FROM operation_outbox WHERE state IN ('PENDING','RETRY','RUNNING')) AS "outboxPending",
      (SELECT count(*)::int FROM operation_outbox WHERE state='FAILED') AS "outboxFailed",
      (SELECT count(*)::int FROM owner_actions WHERE status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')) AS "openOwnerActions",
      (SELECT max(occurred_at) FROM audit_events WHERE kind='maintenance.tick.completed') AS "lastMaintenanceAt"`)
  ]);
  const a=rowsById(runCounts.rows),b=rowsById(current.rows),c=rowsById(charges.rows),d=rowsById(reservations.rows),e=rowsById(github.rows);
  const agents=identity.rows.map(i=>{
    const id=String(i.credentialId),r=a.get(id)??{},now=b.get(id)??{},bill=c.get(id)??{},held=d.get(id)??{},pr=e.get(id)??{};
    const reportedCalls7d=numberOf(bill.reportedCalls7d);
    return {
      credentialId:id,name:String(i.name),provider:String(i.provider),
      sessions24h:numberOf(r.sessions24h),sessions7d:numberOf(r.sessions7d),sessions30d:numberOf(r.sessions30d),
      completed7d:numberOf(r.completed7d),failed7d:numberOf(r.failed7d),blocked7d:numberOf(r.blocked7d),
      activeNow:numberOf(now.activeNow),lastSeenAt:isoOf(r.lastSeenAt),
      activeRepository:now.activeRepository===null||now.activeRepository===undefined?null:String(now.activeRepository),
      inputTokens24h:numberOf(bill.inputTokens24h),outputTokens24h:numberOf(bill.outputTokens24h),
      reportedUsd24h:microUsd(bill.reportedMicro24h),reportedUsd7d:microUsd(bill.reportedMicro7d),
      reportedUsd30d:microUsd(bill.reportedMicro30d),pendingMaximumUsd24h:microUsd(held.pendingMicro24h),
      reportedCalls7d,verifiedMerges7d:numberOf(pr.verifiedMerges7d),mergeDenials7d:numberOf(pr.mergeDenials7d),
      completedRuntimeHours7d:numberOf(r.durationSeconds7d)/3600,
      metering:reportedCalls7d>0?"hosted-reported" as const:"not-observed" as const
    };
  });
  const chargeByDay=new Map(history.rows.map(r=>[String(r.day),r]));
  const sessionByDay=new Map(arrivals.rows.map(r=>[String(r.day),r]));
  const mergesByDay=new Map(merges.rows.map(r=>[String(r.day),r]));
  const days: FleetDay[]=[];
  const utc=new Date();utc.setUTCHours(0,0,0,0);
  for(let i=13;i>=0;i--){
    const day=new Date(utc.getTime()-i*86400000).toISOString().slice(0,10);
    const charge=chargeByDay.get(day)??{},run=sessionByDay.get(day)??{},merge=mergesByDay.get(day)??{};
    days.push({day,reportedUsd:microUsd(charge.microUsd),calls:numberOf(charge.calls),
      sessions:numberOf(run.sessions),verifiedMerges:numberOf(merge.merges)});
  }
  const rawCap=env.BOARDROOM_DAILY_COST_CAP_MICROUSD;
  const cap=rawCap!==undefined&&/^[0-9]+$/.test(rawCap)&&Number(rawCap)>0?Number(rawCap)/1_000_000:null;
  const sum=(f:(x:AgentUsageRow)=>number)=>agents.reduce((t,x)=>t+f(x),0);
  const healthRow=health.rows[0]??{};
  return {
    observedAt:new Date().toISOString(),agents,days,hostedRollingCapUsd:cap,
    summary:{active:sum(x=>x.activeNow),recovering:numberOf(healthRow.recovering),sessions24h:sum(x=>x.sessions24h),
      reportedUsd24h:sum(x=>x.reportedUsd24h),pendingMaximumUsd24h:sum(x=>x.pendingMaximumUsd24h),
      verifiedMerges7d:sum(x=>x.verifiedMerges7d),unmeteredAgents:agents.filter(x=>x.metering==="not-observed").length,
      outboxPending:numberOf(healthRow.outboxPending),outboxFailed:numberOf(healthRow.outboxFailed),
      openOwnerActions:numberOf(healthRow.openOwnerActions),lastMaintenanceAt:isoOf(healthRow.lastMaintenanceAt)},
    limitations:[
      "Native ChatGPT Work credits, balances and reasoning effort are not available from the Boardroom MCP integration.",
      "Hosted runner dollar values are calculated from provider-reported tokens and operator-configured rates, not invoices or ChatGPT credits.",
      "Unreconciled reservations are possible maximum exposure, not confirmed charges; failed calls may not emit usage events.",
      "Session counts exclude activations that never reached Boardroom. Repository progress is independently confirmed through GitHub."
    ]
  };
}

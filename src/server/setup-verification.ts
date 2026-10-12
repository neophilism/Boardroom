import type {Pool} from "pg";
import {getSystemStatus,type SystemStatus} from "./system-status.ts";

export type VerifiedSetup={
  actionKey:string;verified:boolean;newlyVerified:boolean;
};

/** Accept only *observed* configured service dependencies. No raw credentials,
 * private keys, or connection URLs enter owner action contents or audit events.
 */
export async function verifyOwnerSetup(db:Pool,env:NodeJS.ProcessEnv):Promise<{
  actions:VerifiedSetup[];system:SystemStatus;
}>{
  const system=await getSystemStatus(db,env);
  if(!system.database.connected)
    throw new Error("Setup verification requires an available Boardroom database");
  const decisions=[
    {actionKey:"boardroom:render-database",verified:system.database.connected},
    {actionKey:"boardroom:render-owner-credentials",verified:system.database.migrationsReady},
    {actionKey:"boardroom:github-app",verified:system.github.verifiedConnected}
  ];
  const actions:VerifiedSetup[]=[];
  for(const decision of decisions){
    let newlyVerified=false;
    if(decision.verified){
      const updated=await db.query<{action_id:string}>(
        "UPDATE owner_actions SET status='VERIFIED',updated_at=now(),resolved_at=now() "+
        "WHERE action_key=$1 AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') "+
        "RETURNING action_id",[decision.actionKey]
      );
      if(updated.rowCount){
        newlyVerified=true;
        await db.query(
          "INSERT INTO audit_events(kind,details) VALUES('owner.setup.verified',$1::jsonb)",
          [JSON.stringify({actionKey:decision.actionKey,verification:"live_runtime_check"})]
        );
      }
    }
    actions.push({...decision,newlyVerified});
  }
  return {actions,system};
}

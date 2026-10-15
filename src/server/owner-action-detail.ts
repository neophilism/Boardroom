import type {Pool} from "pg";

export type OwnerActionDetail={
  action_id:string;title:string;action_type:string;instructions:string;status:string;
  requested_permissions:string[];secure_entry_location:string|null;price_estimate_cents:string|null;
  created_at:Date;updated_at:Date;resolved_at:Date|null;reason:string|null;
  affected:{repositoryId:string;fullName:string;unitId:string|null}[];
};

export function describeOwnerActionUrgency(status:string):string{
  if(status==="AWAITING_VERIFICATION")return "Verify now";
  if(status==="OPEN"||status==="ACKNOWLEDGED")return "Blocks affected work";
  return "No longer active";
}

export function ownerActionLinks(...values:(string|null)[]):string[]{
  const links=values.flatMap(value=>value?.match(/https:\/\/[^\s<>"')\]]+/g)??[]);
  return [...new Set(links)];
}

export async function getOwnerActionDetail(db:Pool,actionId:string):Promise<OwnerActionDetail|null>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId))return null;
  const result=await db.query<OwnerActionDetail>(
    `SELECT a.action_id,a.title,a.action_type,a.instructions,a.status,a.requested_permissions,
      a.secure_entry_location,a.price_estimate_cents,a.created_at,a.updated_at,a.resolved_at,
      (SELECT e.details->>'condition' FROM audit_events e
       WHERE e.kind='owner_action.requested' AND e.details->>'actionId'=a.action_id::text
       ORDER BY e.occurred_at ASC LIMIT 1) AS reason,
      COALESCE(json_agg(json_build_object(
        'repositoryId',d.repository_id::text,'fullName',r.full_name,'unitId',d.unit_id
      ) ORDER BY r.full_name,d.repository_id,d.unit_id) FILTER (WHERE d.repository_id IS NOT NULL),'[]'::json) AS affected
    FROM owner_actions a
    LEFT JOIN owner_action_dependents d ON d.action_id=a.action_id
    LEFT JOIN repositories r ON r.repository_id=d.repository_id
    WHERE a.action_id=$1::uuid
    GROUP BY a.action_id`,
    [actionId]
  );
  return result.rows[0]??null;
}

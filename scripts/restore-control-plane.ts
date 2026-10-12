import {Client} from 'pg';
import {spawn} from 'node:child_process';
const uri=process.env.BOARDROOM_RESTORE_DATABASE_URL,file=process.argv[2];
if(process.env.BOARDROOM_RESTORE_CONFIRMED!=="true"||!uri||!file)throw new Error("Explicit restore confirmation, an EMPTY recovery database, and a private backup are required");
const parsed=new URL(uri);if(parsed.hostname.includes('-pooler.'))throw new Error("Recovery requires a direct connection");
const db=new Client({connectionString:uri});await db.connect();
try{
  const tables=await db.query("SELECT COUNT(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  if(tables.rows[0].count!==0)throw new Error("Refusing to restore into a nonempty database");
  const restore=spawn('pg_restore',['--no-owner','--no-acl','--exit-on-error',file],{env:{...process.env,PGDATABASE:uri},stdio:'ignore'});
  const code=await new Promise(resolve=>{restore.once('error',()=>resolve(1));restore.once('exit',resolve);});
  if(code!==0)throw new Error("Recovery restore failed");
  await db.query('BEGIN');
  await db.query("UPDATE agent_credentials SET enabled=FALSE,revoked_at=COALESCE(revoked_at,now())");
  await db.query("UPDATE agent_runs SET state='CANCELLED',ended_at=now() WHERE ended_at IS NULL");
  await db.query("UPDATE work_assignments SET released_at=now(),outcome='CANCELLED' WHERE released_at IS NULL");
  await db.query("UPDATE repository_leases SET generation=generation+1,run_id=NULL,expires_at=NULL,last_heartbeat_at=NULL,assigned_at=NULL");
  await db.query("UPDATE repositories SET enabled=FALSE");
  await db.query("UPDATE execution_controls SET paused=TRUE");
  await db.query("INSERT INTO audit_events(kind,details) VALUES('recovery.restored_fenced','{\"oldCredentialsRevoked\":true,\"repositoriesDisabled\":true}'::jsonb)");
  await db.query('COMMIT');
  console.log("Recovery restored with execution paused, old credentials revoked, and repositories disabled. Reconcile GitHub and verify outside process termination before re-enabling.");
}catch{await db.query('ROLLBACK').catch(()=>undefined);console.error("Recovery unavailable; no running execution is claimed.");process.exitCode=1;}finally{await db.end();}

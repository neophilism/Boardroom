export function auditBefore(value:unknown):string|null{
  return typeof value==="string"&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n?value:null;
}
export function auditKind(value:unknown):string{
  return typeof value==="string"&&/^[a-z][a-z0-9_.-]{0,95}$/.test(value)?value:"unrecognized.event";
}

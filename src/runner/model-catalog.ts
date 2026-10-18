/** Model qualification is explicit and versioned; this file does NOT enable APIs. */
export type ModelProvider="openai"|"anthropic"|"xai"|"google";
export type ReasoningSetting="none"|"low"|"medium"|"high"|"xhigh"|"max"|"adaptive";
export type ModelLifecycle="CANDIDATE"|"QUALIFIED"|"RETIRED";
export type ModelRecord={
  provider:ModelProvider;modelId:string;revision:string;
  lifecycle:ModelLifecycle;snapshotPinned:boolean;
  reasoningSettings:ReasoningSetting[];
  supportsTools:boolean;
  modalities:("text"|"image"|"audio"|"video")[];
  contextWindow:number|null;maxOutputTokens:number|null;
  sourceUrl:string;observedAt:string;expiresAt:string;
  qualificationEvidenceUrl:string|null;
};
export type ModelCatalog={schemaVersion:1;catalogVersion:number;models:ModelRecord[]};
export class ModelCatalogInvalid extends Error{
  constructor(message="Model catalog invalid"){super(message);this.name="ModelCatalogInvalid";}
}
const PROVIDERS=["openai","anthropic","xai","google"];
const EFFORTS=["none","low","medium","high","xhigh","max","adaptive"];
const MODALITIES=["text","image","audio","video"];
const LIFECYCLES=["CANDIDATE","QUALIFIED","RETIRED"];
const SOURCE_HOSTS:Record<ModelProvider,string[]>={
  openai:["developers.openai.com","platform.openai.com"],
  anthropic:["platform.claude.com","docs.anthropic.com"],
  xai:["docs.x.ai"],
  google:["ai.google.dev"]
};
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v);}
function validIso(value:unknown):value is string{
  return typeof value==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
}
function modelUrl(provider:ModelProvider,value:unknown):boolean{
  if(typeof value!=="string"||value.length>300)return false;
  try{
    const url=new URL(value);
    return url.protocol==="https:"&&!url.username&&!url.password&&
      SOURCE_HOSTS[provider].includes(url.hostname)&&!url.hash;
  }catch{return false;}
}
function safeEvidenceUrl(value:unknown):boolean{
  if(typeof value!=="string"||value.length>300)return false;
  return /^https:\/\/github\.com\/neophilism\/Boardroom\/actions\/runs\/[1-9][0-9]{0,19}(?:\/job\/[1-9][0-9]{0,19})?$/.test(value);
}
function boundedInt(n:unknown,max:number):n is number{
  return typeof n==="number"&&Number.isSafeInteger(n)&&n>0&&n<=max;
}
export function parseModelCatalog(source:unknown):ModelCatalog{
  if(!record(source)||source.schemaVersion!==1||!boundedInt(source.catalogVersion,1_000_000)||
      !Array.isArray(source.models)||source.models.length>500)
    throw new ModelCatalogInvalid();
  const models:ModelRecord[]=[],names=new Set<string>();
  for(const row of source.models){
    if(!record(row)||typeof row.provider!=="string"||!PROVIDERS.includes(row.provider)||
      typeof row.modelId!=="string"||!/^[-A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(row.modelId)||
      typeof row.revision!=="string"||!/^[A-Za-z0-9._:-]{1,120}$/.test(row.revision)||
      !LIFECYCLES.includes(String(row.lifecycle))||typeof row.snapshotPinned!=="boolean"||
      typeof row.supportsTools!=="boolean"||!Array.isArray(row.reasoningSettings)||
      row.reasoningSettings.length>7||row.reasoningSettings.some(x=>!EFFORTS.includes(x))||
      new Set(row.reasoningSettings).size!==row.reasoningSettings.length||
      !Array.isArray(row.modalities)||row.modalities.length>4||
      row.modalities.some(x=>!MODALITIES.includes(x))||new Set(row.modalities).size!==row.modalities.length||
      (row.contextWindow!==null&&!boundedInt(row.contextWindow,10_000_000))||
      (row.maxOutputTokens!==null&&!boundedInt(row.maxOutputTokens,1_000_000))||
      !validIso(row.observedAt)||!validIso(row.expiresAt)||
      Date.parse(row.expiresAt)<=Date.parse(row.observedAt)||!modelUrl(row.provider as ModelProvider,row.sourceUrl))
      throw new ModelCatalogInvalid("Invalid model version, capability or official source");
    const id=row.provider+":"+row.modelId;
    if(names.has(id))throw new ModelCatalogInvalid("Duplicate provider/model identifier");
    names.add(id);
    const qualified=row.lifecycle==="QUALIFIED";
    // No changing aliases, or externally unverified "qualification" labels.
    if(qualified&&(!row.snapshotPinned||!safeEvidenceUrl(row.qualificationEvidenceUrl)||
      Date.parse(row.expiresAt)-Date.parse(row.observedAt)>1000*60*60*24*90))
      throw new ModelCatalogInvalid("Qualified models require a pinned snapshot and recent Boardroom conformance evidence");
    if(!qualified&&row.qualificationEvidenceUrl!==null&&!safeEvidenceUrl(row.qualificationEvidenceUrl))
      throw new ModelCatalogInvalid("Invalid qualification evidence");
    models.push(row as ModelRecord);
  }
  return {schemaVersion:1,catalogVersion:source.catalogVersion as number,models};
}
/** Exact model + native effort, no implicit downgrade or changing alias. */
export function requireQualifiedModel(catalog:ModelCatalog,provider:ModelProvider,id:string,
  setting:ReasoningSetting,now=Date.now()):ModelRecord{
  if(!Number.isFinite(now))throw new ModelCatalogInvalid();
  const validated=parseModelCatalog(catalog);
  const candidate=validated.models.find(m=>m.provider===provider&&m.modelId===id);
  if(!candidate||candidate.lifecycle!=="QUALIFIED"||!candidate.snapshotPinned||
     Date.parse(candidate.observedAt)>now||Date.parse(candidate.expiresAt)<=now)
    throw new ModelCatalogInvalid("Requested model is not presently qualified");
  if(!candidate.reasoningSettings.includes(setting))
    throw new ModelCatalogInvalid("Requested reasoning setting is unsupported; no automatic downgrade");
  return candidate;
}

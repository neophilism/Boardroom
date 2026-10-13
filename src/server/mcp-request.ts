export class McpRequestError extends Error{
  readonly code:-32700|-32600|-32602;
  readonly requestId:string|number|null;
  constructor(code:-32700|-32600|-32602,requestId:string|number|null=null){
    super(code===-32700?"Parse error":code===-32600?"Invalid request":"Invalid params");
    this.code=code;this.requestId=requestId;
  }
}
export type McpRequest={jsonrpc:"2.0";id?:string|number|null;method:string;params?:Record<string,unknown>};
export function parseMcpRequest(raw:string):McpRequest{
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw new McpRequestError(-32700);}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new McpRequestError(-32600);
  const request=value as Record<string,unknown>;
  if(request.jsonrpc!=="2.0"||typeof request.method!=="string"||
    (request.id!==undefined&&request.id!==null&&typeof request.id!=="string"&&
      !(typeof request.id==="number"&&Number.isFinite(request.id))))throw new McpRequestError(-32600);
  const id=request.id as string|number|null|undefined;
  if(request.params!==undefined&&(!request.params||typeof request.params!=="object"||Array.isArray(request.params)))
    throw new McpRequestError(-32602,id??null);
  // Operational requests must have a response ID. Never execute a mutation
  // hidden in an unacknowledged notification.
  if(id===undefined&&!request.method.startsWith("notifications/"))throw new McpRequestError(-32600);
  return request as McpRequest;
}

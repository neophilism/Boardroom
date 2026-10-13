export class RequestBodyTooLarge extends Error{constructor(){super("Request body exceeds the allowed size");}}
/** Stop reading at the byte boundary instead of buffering an unbounded body
 * before checking its length. These routes contain no caller-controlled URLs. */
export async function boundedRequestText(request:Request,limit:number):Promise<string>{
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error("Invalid body limit");
  const length=request.headers.get("content-length");
  if(length&&/^\d+$/.test(length)&&Number(length)>limit)throw new RequestBodyTooLarge();
  if(!request.body)return "";
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{
    for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;
      if(bytes>limit){await reader.cancel();throw new RequestBodyTooLarge();}chunks.push(next.value);}
    return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
  }finally{reader.releaseLock();}
}

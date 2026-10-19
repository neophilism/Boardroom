/** Detection is a privacy backstop, never authorization or proof that text is safe. */
const inspectionDecoder=new TextDecoder("utf-8",{fatal:false});
function normalizedForInspection(value:string){
  let text=value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"");
  for(let i=0;i<2;i++)text=text.replace(/(?:%[a-f0-9]{2})+/gi,encoded=>{
    // Inspection only: replace invalid UTF-8 rather than abandoning the whole
    // run and missing valid credential bytes next to it. Never use this lossy
    // representation for URLs, authorization, storage or rendered content.
    const bytes=new Uint8Array(encoded.length/3);
    for(let offset=0;offset<bytes.length;offset++)
      bytes[offset]=Number.parseInt(encoded.slice(offset*3+1,offset*3+3),16);
    return inspectionDecoder.decode(bytes);
  });
  return text.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"");
}
const credentials=/(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:rnd_|napi_)[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|api[ _-]?key|secret|token)["']?\s*[:=]\s*["']?[A-Za-z0-9+/.=_-]{8,}|authorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9+/._=-]{8,}|[a-z][a-z0-9+.-]*:\/\/[^\s/?#:@]+:[^\s@]+@)/i;

function validCardCandidate(value:string){
  const digits=value.replace(/\D/g,"");
  if(digits.length<13||digits.length>19||/^0+$/.test(digits))return false;
  let total=0,double=false;
  for(let i=digits.length-1;i>=0;i--){let digit=Number(digits[i]);if(double){digit*=2;if(digit>9)digit-=9;}total+=digit;double=!double;}
  return total%10===0;
}

export function containsSensitiveDiscussionData(value:string){
  if(value.length>20000)return true;
  const text=normalizedForInspection(value);
  if(credentials.test(text)||/\b\d{3}-\d{2}-\d{4}\b/.test(text))return true;
  const emails=text.matchAll(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi);
  for(const email of emails)if(!/^(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net|test)|invalid)$/i.test(email[1]))return true;
  return [...text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)].some(match=>validCardCandidate(match[0]));
}

export const WITHHELD_DISCUSSION_TEXT="[Content withheld: potential credential or personal data.]";
export function safeDiscussionText(value:unknown){
  return typeof value!=="string"||containsSensitiveDiscussionData(value)?WITHHELD_DISCUSSION_TEXT:value;
}

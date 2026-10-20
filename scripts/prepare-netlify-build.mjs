import {writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

/** Only provider-supplied immutable Git commits may be embedded in the
 * public health response. A missing/invalid ref aborts the hosted build.
 */
export function netlifyBuildRevision(env){
  const raw=env.COMMIT_REF;
  if(typeof raw!=="string"||!/^[a-f0-9]{40}$/i.test(raw))
    throw new Error("Netlify build requires a validated 40-character COMMIT_REF");
  return raw.toLowerCase();
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const revision=netlifyBuildRevision(process.env);
  await writeFile(new URL("../src/domain/netlify-build-revision.json",import.meta.url),
    JSON.stringify({revision})+"\n","utf8");
  console.log("Embedded the public source revision in the Next.js build.");
}

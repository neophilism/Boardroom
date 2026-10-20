import netlifyRelease from "./netlify-build-revision.json" with { type: "json" };

/** Container releases use their embedded image SHA. For Netlify, the immutable
 * commit is recorded in a source module before next build, never inferred from
 * an untrusted HTTP header or request URL. Invalid metadata fails closed.
 */
export function deploymentRevision(env:Record<string,string|undefined>):string|null{
  const value=env.BOARDROOM_BUILD_REVISION??env.RENDER_GIT_COMMIT??netlifyRelease.revision;
  return typeof value==="string"&&/^[a-f0-9]{40}$/i.test(value)?value:null;
}

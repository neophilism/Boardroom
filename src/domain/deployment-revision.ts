import netlifyRelease from "./netlify-build-revision.json" with { type: "json" };

/** Each provider reports only validated immutable source SHA metadata.
 * Native containers prefer their build SHA. Serverless hosts may provide an
 * explicitly configured release SHA; request headers are never trusted.
 */
export function deploymentRevision(env:Record<string,string|undefined>):string|null{
  const value=env.BOARDROOM_BUILD_REVISION??env.RENDER_GIT_COMMIT??
    env.BOARDROOM_RELEASE_SHA??env.KOYEB_GIT_SHA??netlifyRelease.revision;
  return typeof value==="string"&&/^[a-f0-9]{40}$/i.test(value)?value:null;
}

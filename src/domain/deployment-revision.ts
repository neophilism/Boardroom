/** Prebuilt images carry their public source SHA. A stale native Render value
 * must not hide the actual image revision. Invalid image metadata fails closed. */
export function deploymentRevision(env:Record<string,string|undefined>):string|null{
  const value=env.BOARDROOM_BUILD_REVISION??env.RENDER_GIT_COMMIT;
  return typeof value==="string"&&/^[a-f0-9]{40}$/i.test(value)?value:null;
}

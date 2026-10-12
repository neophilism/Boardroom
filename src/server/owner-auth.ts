import {createHash,timingSafeEqual} from "node:crypto";
export class UnauthorizedOwner extends Error {
  constructor() {super("Owner authorization required");this.name="UnauthorizedOwner";}
}
export function authorizeOwner(headers: Headers): void {
  const secret=process.env.BOARDROOM_OWNER_API_TOKEN;
  if (!secret || secret.length < 32) throw new Error("BOARDROOM_OWNER_API_TOKEN missing or too short");
  const header=headers.get("authorization") ?? "";
  const candidate=header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(candidate)) throw new UnauthorizedOwner();
  const expectedHash=createHash("sha256").update(secret).digest();
  const actualHash=createHash("sha256").update(candidate).digest();
  if (!timingSafeEqual(expectedHash,actualHash)) throw new UnauthorizedOwner();
}

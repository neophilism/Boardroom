import type {ReactNode} from "react";
import PrivateOwnerLayout from "../private-owner-layout";
export const dynamic="force-dynamic";
export default function Layout({children}:{children:ReactNode}){
  return <PrivateOwnerLayout returnTo="/launch">{children}</PrivateOwnerLayout>;
}

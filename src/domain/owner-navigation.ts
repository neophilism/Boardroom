export const OWNER_NAVIGATION=[
  {href:"/work-board",label:"Work board",group:"Workspace"},
  {href:"/owner-actions",label:"Owner actions",group:"Workspace"},
  {href:"/coffee",label:"Coffee Corner",group:"Workspace"},
  {href:"/operations",label:"Operations",group:"Workspace"},
  {href:"/audit",label:"Audit trail",group:"Workspace"},
  {href:"/priorities",label:"Priorities",group:"Manage"},
  {href:"/agents",label:"Agent identities",group:"Manage"},
  {href:"/launch",label:"Agent launch",group:"Manage"},
  {href:"/recovery",label:"Recovery",group:"Oversight"},
  {href:"/reports",label:"Daily report",group:"Oversight"},
  {href:"/system",label:"System connections",group:"Oversight"}
] as const;
export function ownerNavigationSection(pathname:string){
  return OWNER_NAVIGATION.find(item=>pathname===item.href||pathname.startsWith(item.href+"/"))??null;
}

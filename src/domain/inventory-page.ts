/** A failing repository stays unapproved, but never stops pagination for other repositories. */
export type InventoryPage={processed:number;failed:number;nextAfterId:string|null;
  errors:{repository:string;reason:string}[]};
export function inventoryPageOutcome(report:InventoryPage){
  if(!Number.isSafeInteger(report.processed)||report.processed<0||
     !Number.isSafeInteger(report.failed)||report.failed<0||report.failed>report.processed||
     !Array.isArray(report.errors)||report.errors.length!==report.failed||
     (report.nextAfterId!==null&&!/^[1-9][0-9]{0,18}$/.test(report.nextAfterId)))
    throw new Error("Invalid inventory sync report");
  return {
    partial:report.failed>0,
    nextAfterId:report.nextAfterId,
    failedRepositories:report.errors.slice(0,10).map(error=>error.repository)
  };
}

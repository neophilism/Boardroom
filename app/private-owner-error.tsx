"use client";
import Link from "next/link";
export default function PrivateOwnerError({reset}:{reset:()=>void}){
  return <main className="owner-shell"><section className="action-card" role="alert"><p className="eyebrow">BOARDROOM / VIEW UNAVAILABLE</p>
    <h1>This view is temporarily unavailable</h1><p>No status is being inferred from this failure. Retry the read or return to the work board. Private error details and provider responses are not displayed here.</p>
    <div className="card-actions"><button onClick={reset}>Try again</button><Link className="priority-nav" href="/work-board">Work board</Link></div>
  </section></main>;
}

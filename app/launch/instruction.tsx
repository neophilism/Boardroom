"use client";
import {useState} from "react";
import {SCHEDULED_AGENT_INSTRUCTION} from "../../src/domain/scheduled-instruction";

export default function SharedAgentInstruction(){
  const [message,setMessage]=useState("");
  async function copy(){
    try{await navigator.clipboard.writeText(SCHEDULED_AGENT_INSTRUCTION);setMessage("Shared instruction copied.");}
    catch{setMessage("Select and copy the instruction from the field below.");}
  }
  return <section className="action-card">
    <h2>One instruction for all five agents</h2>
    <p>Use the same text unchanged in every scheduled task. Select the agent&apos;s named connection separately; its authenticated profile supplies the name.</p>
    <button type="button" onClick={copy}>Copy shared instruction</button>
    <textarea aria-label="Shared scheduled-agent instruction" readOnly value={SCHEDULED_AGENT_INSTRUCTION}
      rows={18} style={{width:"100%",marginTop:"1rem"}} onFocus={e=>e.target.select()}/>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}

"use client";

import { motion, useReducedMotion } from "motion/react";
import { DocumentText, Flash, People, ShieldTick } from "@/components/icons";

const OUTCOMES = [
  { number: "01", title: "Pay the right person", body: "Convey resolves names against people you know, checks the request, and prepares a payment for your approval.", icon: People },
  { number: "02", title: "Turn receipts into requests", body: "Photograph a bill, correct the extracted items, and decide exactly who owes what before asking anyone to pay.", icon: DocumentText },
  { number: "03", title: "Continue when signal drops", body: "Carry a payment request between devices with a scannable, tamper-evident handoff and finish safely when you reconnect.", icon: Flash },
  { number: "04", title: "Put hard limits on automation", body: "Describe a protection goal, then bind it to a time window, spend cap, loss cap, and kill switch.", icon: ShieldTick },
] as const;

const PROOF = [
  ["Gonka", "Intent routed to an exact pinned model"],
  ["Sui", "Every transfer still requires wallet approval"],
  ["Receipts", "Outcomes can be checked independently"],
  ["PWA", "Installable across desktop and mobile"],
] as const;

export function CompanionShowcase() {
  const reduceMotion = useReducedMotion();
  const reveal = reduceMotion ? {} : { initial: { y: 22 }, whileInView: { y: 0 }, viewport: { once: true, amount: 0.24 }, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    <section className="companion-story mx-auto w-full max-w-[1380px] px-4 pb-16 pt-8 md:px-6 md:pb-24 md:pt-14">
      <motion.div {...reveal} className="companion-story-heading">
        <p className="companion-eyebrow text-black/42">One conversation. Guarded outcomes.</p>
        <h2>Money should feel as simple as sending a message.</h2>
        <p>Convey hides the crypto mechanics without hiding the decision. You describe the outcome; it prepares the safest next step.</p>
      </motion.div>
      <div className="companion-outcome-grid">
        {OUTCOMES.map(({ number, title, body, icon: Icon }, index) => (
          <motion.article key={number} {...reveal} transition={reduceMotion ? undefined : { duration: 0.52, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }} className="companion-outcome-tile">
            <div className="flex items-center justify-between"><span className="companion-outcome-number">{number}</span><Icon size={19} /></div>
            <h3>{title}</h3><p>{body}</p>
          </motion.article>
        ))}
      </div>
      <motion.div {...reveal} className="companion-proof-band">
        <div><p className="companion-eyebrow text-white/42">Built for trust</p><h2>Clear before clever.</h2></div>
        <div className="companion-proof-list">
          {PROOF.map(([label, detail]) => <div key={label}><span>{label}</span><p>{detail}</p><ShieldTick size={16} /></div>)}
        </div>
      </motion.div>
    </section>
  );
}

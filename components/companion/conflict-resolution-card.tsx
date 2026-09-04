"use client";

import { useState } from "react";
import { Judge, People, ShieldTick, TickCircle } from "@/components/icons";

type ChallengeParty = "user" | "employer";

const REVIEW_STEPS = [
  ["01", "Preserve the original evaluation", "Evidence and AI provenance stay unchanged."],
  ["02", "Hear both sides", "The other party can answer the exact challenge."],
  ["03", "Send to a neutral human", "AI can summarize, but cannot decide the appeal."],
  ["04", "Apply the agreed outcome", "Payment changes still require the original authority."],
] as const;

export function ConflictResolutionCard({ onClose }: { onClose: () => void }) {
  const [party, setParty] = useState<ChallengeParty>("user");
  const [reason, setReason] = useState("");
  const [prepared, setPrepared] = useState(false);

  if (prepared) {
    return (
      <section className="conflict-resolution-card overflow-hidden rounded-[26px] border border-black/10 bg-white shadow-[0_22px_55px_rgba(0,0,0,0.08)]" aria-labelledby="conflict-review-ready-title">
        <div className="bg-black px-5 py-6 text-white sm:px-7">
          <div className="flex items-start justify-between gap-5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/8"><TickCircle size={22} /></span>
            <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-white/18 px-4 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Close</button>
          </div>
          <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/48">Independent review</p>
          <h3 id="conflict-review-ready-title" className="mt-2 text-[30px] font-medium leading-[1.02] tracking-[-0.045em]">Review prepared.</h3>
          <p role="status" className="mt-3 max-w-[46ch] text-sm leading-6 text-white/65">
            Review prepared. The challenge is ready for the other party and a neutral human reviewer. Nothing moved.
          </p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-[0.72fr_1.28fr] sm:p-7">
          <div className="rounded-2xl bg-[#f2f2ef] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Raised by</p>
            <p className="mt-2 text-sm font-semibold text-black">{party === "user" ? "User" : "Employer"}</p>
          </div>
          <div className="rounded-2xl border border-black/9 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/42">Challenge</p>
            <p className="mt-2 text-sm leading-6 text-black/68">{reason.trim()}</p>
          </div>
          <p className="text-xs leading-5 text-black/52 sm:col-span-2">
            The original payment terms still govern. A review cannot release, refund, or redirect funds by itself.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="conflict-resolution-card overflow-hidden rounded-[26px] border border-black/10 bg-white shadow-[0_22px_55px_rgba(0,0,0,0.08)]" aria-labelledby="conflict-review-title">
      <header className="border-b border-black/8 bg-[#f6f6f3] px-5 py-6 sm:px-7">
        <div className="flex items-start justify-between gap-5">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black text-white"><Judge size={22} /></span>
          <button type="button" onClick={onClose} className="min-h-11 rounded-full border border-black/12 px-4 text-xs font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">Close</button>
        </div>
        <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-black/42">Independent review</p>
        <h3 id="conflict-review-title" className="mt-2 max-w-[14ch] text-[30px] font-medium leading-[1.02] tracking-[-0.045em] text-black sm:text-[36px]">Challenge the decision, not the person.</h3>
        <p className="mt-3 max-w-[55ch] text-sm leading-6 text-black/58">
          Preserve the AI evaluation, add the missing context, and ask a neutral human to review both sides before any payment changes.
        </p>
      </header>

      <form className="grid gap-6 p-5 sm:p-7" onSubmit={(event) => { event.preventDefault(); if (reason.trim().length >= 12) setPrepared(true); }}>
        <fieldset>
          <legend className="text-xs font-semibold text-black">Who is challenging the evaluation?</legend>
          <div role="group" aria-label="Challenge party" className="mt-3 grid grid-cols-2 gap-2">
            {(["user", "employer"] as const).map((value) => {
              const selected = party === value;
              const Icon = value === "user" ? People : ShieldTick;
              return (
                <button key={value} type="button" aria-pressed={selected} onClick={() => setParty(value)} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${selected ? "border-black bg-black text-white" : "border-black/10 bg-white text-black"}`}>
                  <Icon size={17} />
                  {value === "user" ? "User" : "Employer"}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="text-xs font-semibold text-black">
          What should be reconsidered?
          <textarea value={reason} onChange={(event) => setReason(event.target.value.slice(0, 600))} rows={4} placeholder="Describe the missing evidence, incorrect assumption, or disputed result." className="mt-3 w-full resize-y rounded-2xl border border-black/12 bg-white p-4 text-sm font-normal leading-6 text-black outline-none placeholder:text-black/35 focus:border-black" />
          <span className="mt-2 block text-right text-[10px] font-medium text-black/38">{reason.length}/600</span>
        </label>

        <ol className="grid overflow-hidden rounded-2xl border border-black/9 sm:grid-cols-2">
          {REVIEW_STEPS.map(([number, title, detail]) => (
            <li key={number} className="min-h-24 border-b border-black/8 p-4 sm:even:border-l sm:[&:nth-last-child(-n+2)]:border-b-0">
              <span className="text-[9px] font-semibold tabular-nums text-black/35">{number}</span>
              <strong className="mt-2 block text-xs font-semibold text-black">{title}</strong>
              <small className="mt-1 block text-[10px] leading-4 text-black/48">{detail}</small>
            </li>
          ))}
        </ol>

        <button type="submit" disabled={reason.trim().length < 12} className="min-h-12 rounded-xl bg-black px-5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
          Prepare neutral review
        </button>
      </form>
    </section>
  );
}

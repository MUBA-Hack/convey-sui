"use client";

import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, DocumentText, MoneyRecive, People, ShieldTick, Wallet } from "@/components/icons";

type TaskKind = "receive" | "request" | "split" | "allowance" | "pass";

type GeneratedTask = {
  kind: TaskKind;
  title: string;
  subtitle: string;
  payload: string;
  whatsappText: string;
};

const TASKS = [
  { id: "receive", label: "Receive", detail: "Show your code", icon: Wallet },
  { id: "request", label: "Request", detail: "Ask one person", icon: MoneyRecive },
  { id: "split", label: "Split", detail: "Collect by WhatsApp", icon: People },
  { id: "allowance", label: "Allowance", detail: "Limit purpose and time", icon: ShieldTick },
  { id: "pass", label: "Payment pass", detail: "Issue with conditions", icon: DocumentText },
] as const;

function createPayload(kind: TaskKind, data: Record<string, string | number | undefined>) {
  return JSON.stringify({
    kind: "convey.qr-task",
    version: 1,
    task: kind,
    createdAt: new Date().toISOString(),
    reviewRequired: true,
    ...data,
  });
}

function majorToMinor(value: string): number | null {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function formatMinor(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

function shareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function QrTaskStudio() {
  const [active, setActive] = useState<TaskKind>("receive");
  const [name, setName] = useState("Maya");
  const [amount, setAmount] = useState("12.00");
  const [note, setNote] = useState("Dinner");
  const [participants, setParticipants] = useState("Maya, Idris, Sam");
  const [category, setCategory] = useState("Groceries");
  const [days, setDays] = useState("7");
  const [receiveAddress, setReceiveAddress] = useState("");
  const [generated, setGenerated] = useState<GeneratedTask[]>([]);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = generated[selected] ?? null;
  const activeLabel = useMemo(() => TASKS.find((task) => task.id === active)?.label ?? "QR", [active]);

  function generate() {
    const minor = majorToMinor(amount);
    if (minor === null) {
      setError("Enter a valid amount greater than zero with no more than two decimals.");
      return;
    }
    const expiresInDays = Math.max(1, Math.min(90, Number(days) || 7));
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
    if (active === "receive" && !/^0x[a-fA-F0-9]{64}$/.test(receiveAddress.trim())) {
      setError("Enter the Sui address that should receive this payment.");
      return;
    }
    if (active !== "receive" && active !== "split" && !name.trim()) {
      setError("Enter the person who should use this code.");
      return;
    }

    if (active === "split") {
      const people = participants.split(",").map((person) => person.trim()).filter(Boolean).slice(0, 8);
      if (people.length === 0) {
        setError("Add at least one person to the split.");
        return;
      }
      const base = Math.floor(minor / people.length);
      const remainder = minor % people.length;
      const tasks = people.map((person, index) => {
        const shareMinor = base + (index < remainder ? 1 : 0);
        const share = formatMinor(shareMinor);
        const payload = createPayload("split", { recipient: person, amount: share, asset: "USDC", note, expiresAt });
        const message = `${person}, your ${note || "group"} share is ${share} USDC. Open this request, review it, then approve in your wallet: ${location.origin}/qr-ferry?code=${encodeURIComponent(payload)}`;
        return { kind: "split" as const, title: `${person}'s share`, subtitle: `${share} USDC · ${note || "Group split"}`, payload, whatsappText: message };
      });
      setGenerated(tasks);
      setSelected(0);
      setError(null);
      return;
    }

    const taskData = active === "receive"
      ? { recipient: "You", address: receiveAddress.trim(), amount: formatMinor(minor), asset: "USDC", note }
      : active === "request"
        ? { recipient: name.trim(), amount: formatMinor(minor), asset: "USDC", note, expiresAt }
        : active === "allowance"
          ? { beneficiary: name.trim(), limit: formatMinor(minor), asset: "USDC", category, expiresAt }
          : { recipient: name.trim(), amount: formatMinor(minor), asset: "USDC", condition: note, expiresAt, status: "issued" };
    const payload = createPayload(active, taskData);
    const title = active === "receive" ? "Your receive code" : active === "request" ? `Request from ${name}` : active === "allowance" ? `${category} allowance` : `Payment pass for ${name}`;
    const subtitle = `${formatMinor(minor)} USDC${active === "allowance" ? ` · ${expiresInDays} days` : note ? ` · ${note}` : ""}`;
    const whatsappText = `${title}: ${subtitle}. Open, review, then approve: ${location.origin}/qr-ferry?code=${encodeURIComponent(payload)}`;
    setGenerated([{ kind: active, title, subtitle, payload, whatsappText }]);
    setSelected(0);
    setError(null);
  }

  async function copyCode() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("Copy is unavailable here. Use WhatsApp or scan the QR instead.");
    }
  }

  return (
    <section className="mt-5" aria-labelledby="qr-create-title">
      <div className="mb-4 flex items-end justify-between gap-4 px-1">
        <div>
          <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Create a code</p>
          <h2 id="qr-create-title" className="mt-1 text-2xl font-semibold tracking-[-0.035em]">One QR, the right rules.</h2>
        </div>
        <span className="hidden text-right text-[11px] leading-5 text-neutral-500 sm:block">Every code opens a review.<br />A code never moves funds alone.</span>
      </div>

      <div className="qr-task-tabs" aria-label="QR task type">
        {TASKS.map(({ id, label, detail, icon: Icon }) => (
          <button key={id} type="button" aria-pressed={active === id} onClick={() => { setActive(id); setGenerated([]); }} className={`min-h-11 h-[92px] border p-3 text-left transition-[transform,background,color] duration-200 active:scale-[0.97] ${active === id ? "border-black bg-black text-white" : "border-black/10 bg-white text-black hover:border-black/30"}`}>
            <Icon size={18} />
            <strong className="mt-3 block text-sm font-medium">{label}</strong>
            <small className={`mt-1 block text-[10px] leading-4 ${active === id ? "text-white/55" : "text-black/45"}`}>{detail}</small>
          </button>
        ))}
      </div>

      <div className="qr-task-layout mt-2 overflow-hidden border border-black/10 bg-white">
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-semibold tracking-[-0.025em]">{activeLabel}</h3>
            <span className="font-narrow text-[10px] uppercase tracking-[0.14em] text-neutral-500">Review required</span>
          </div>

          {active === "receive" && <label className="mt-5 block text-xs font-medium">Your Sui address<input aria-label="Receive address" value={receiveAddress} onChange={(event) => setReceiveAddress(event.target.value)} placeholder="0x..." className="mt-2 min-h-12 w-full border border-black/12 px-3 font-mono text-xs outline-none focus:border-black" /></label>}

          {active !== "receive" && active !== "split" && (
            <label className="mt-5 block text-xs font-medium">{active === "allowance" ? "Who can use it?" : "Who is it for?"}<input aria-label={active === "allowance" ? "Allowance beneficiary" : "Recipient name"} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-12 w-full border border-black/12 px-3 outline-none focus:border-black" /></label>
          )}
          {active === "split" && (
            <label className="mt-5 block text-xs font-medium">Who was there?<input aria-label="Split participants" value={participants} onChange={(event) => setParticipants(event.target.value)} className="mt-2 min-h-12 w-full border border-black/12 px-3 outline-none focus:border-black" /><span className="mt-1.5 block text-[10px] font-normal text-neutral-500">Separate names with commas. Each person gets a personal code and WhatsApp link.</span></label>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium">{active === "allowance" ? "Spending limit" : active === "split" ? "Bill total" : "Amount"}<span className="mt-2 flex min-h-12 items-center border border-black/12 px-3 focus-within:border-black"><input aria-label={`${activeLabel} amount`} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="min-w-0 flex-1 outline-none" /><b className="text-xs">USDC</b></span></label>
            {active === "allowance" ? (
              <label className="block text-xs font-medium">Purpose<select aria-label="Allowance category" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 min-h-12 w-full border border-black/12 bg-white px-3"><option>Groceries</option><option>Transport</option><option>Bills</option><option>Medicine</option><option>Education</option></select></label>
            ) : (
              <label className="block text-xs font-medium">{active === "pass" ? "Release condition" : "Note"}<input aria-label="Payment note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 min-h-12 w-full border border-black/12 px-3 outline-none focus:border-black" /></label>
            )}
          </div>
          {(active === "allowance" || active === "pass" || active === "request" || active === "split") && <label className="mt-4 block max-w-[180px] text-xs font-medium">Expires in<input aria-label="Expiry days" type="number" min="1" max="90" value={days} onChange={(event) => setDays(event.target.value)} className="mt-2 min-h-12 w-full border border-black/12 px-3 outline-none focus:border-black" /></label>}
          {error && <p role="alert" className="mt-3 text-xs font-medium text-red-700">{error}</p>}
          <button type="button" onClick={generate} className="cv-btn-solid mt-5 min-h-11 w-full px-4 py-3 text-xs font-semibold uppercase tracking-[0.13em]">Create {active === "split" ? "personal requests" : `${activeLabel.toLowerCase()} QR`}</button>
        </div>

        <div className="border-t border-black/10 bg-[var(--cv-paper)] p-4 lg:border-t-0 lg:border-l">
          {current ? (
            <div aria-live="polite">
              <div className="flex justify-center bg-white p-4"><QRCodeSVG value={current.payload} size={210} level="M" marginSize={2} title={current.title} /></div>
              <strong className="mt-4 block text-base">{current.title}</strong>
              <span className="mt-1 block text-xs text-neutral-500">{current.subtitle}</span>
              {generated.length > 1 && <div className="mt-3 flex flex-wrap gap-1.5">{generated.map((task, index) => <button key={task.title} type="button" onClick={() => setSelected(index)} aria-pressed={selected === index} className={`min-h-11 border px-2.5 text-[10px] ${selected === index ? "border-black bg-black text-white" : "border-black/12 bg-white"}`}>{task.title}</button>)}</div>}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void copyCode()} className="cv-btn-ghost flex min-h-11 items-center justify-center gap-2 text-xs font-semibold"><Copy size={15} />{copied ? "Copied" : "Copy code"}</button>
                <a href={shareUrl(current.whatsappText)} target="_blank" rel="noreferrer" className="cv-btn-solid flex min-h-11 items-center justify-center text-xs font-semibold">WhatsApp</a>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[260px] flex-col justify-between">
              <ShieldTick size={24} />
              <div><strong className="block text-lg">Ready when you are.</strong><p className="mt-2 text-xs leading-5 text-neutral-500">Set the amount and rules. Convey creates a portable code for the exact task.</p></div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Add, DocumentText, People, Send2, TickCircle, Trash, Warning2 } from "@/components/icons";
import {
  applyObligationEvent,
  createReceiptObligationDraft,
  resolveReceiptParticipant,
  type ReceiptObligationDraft,
} from "@/lib/companion/receipt-obligations";
import { formatUsdc } from "@/lib/remittance/money";
import { createReceiptSplitShare } from "@/lib/remittance/receipt-split-share";
import { parseUsdcDecimalToMicro } from "@/lib/remittance/receipt-split";

type EditableItem = { id: string; label: string; amount: string };
type EditableParticipant = { id: string; displayName: string; detail: string };

const INITIAL_ITEMS: EditableItem[] = [{ id: "item_1", label: "", amount: "" }];
const INITIAL_PARTICIPANTS: EditableParticipant[] = [
  { id: "person_1", displayName: "Ana", detail: "Personal" },
  { id: "person_2", displayName: "Dave", detail: "Personal" },
];
const REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function majorToMicro(value: string): string {
  const parsed = parseUsdcDecimalToMicro(value === "" ? "0" : value);
  if (!parsed.ok) throw new Error("Use an amount with up to six decimal places.");
  return parsed.micro;
}

function stateLabel(state: string): string {
  return `${state.slice(0, 1).toUpperCase()}${state.slice(1)}`;
}

export function ReceiptSplitFlow() {
  const reduceMotion = useReducedMotion();
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  const itemCounter = useRef(2);
  const participantCounter = useRef(3);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [currency, setCurrency] = useState<"SUI" | "USDC">("USDC");
  const [items, setItems] = useState<EditableItem[]>(INITIAL_ITEMS);
  const [tax, setTax] = useState("0");
  const [service, setService] = useState("0");
  const [participants, setParticipants] = useState<EditableParticipant[]>(INITIAL_PARTICIPANTS);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [checked, setChecked] = useState(false);
  const [draft, setDraft] = useState<ReceiptObligationDraft | null>(null);
  const [preparedAt, setPreparedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const invalidate = () => {
    setChecked(false);
    setDraft(null);
    setPreparedAt(null);
    setError(null);
  };

  const duplicateNames = useMemo(() => {
    const seen = new Set<string>();
    return participants.flatMap((participant) => {
      const key = participant.displayName.trim().toLocaleLowerCase("en-US");
      if (!key || seen.has(key)) return [];
      seen.add(key);
      const resolution = resolveReceiptParticipant(participant.displayName, participants);
      return resolution.outcome === "ambiguous"
        ? [{ label: participant.displayName.trim(), count: resolution.participantIds.length }]
        : [];
    });
  }, [participants]);

  const displayTotal = useMemo(() => {
    try {
      const subtotal = items.reduce((sum, item) => sum + BigInt(majorToMicro(item.amount)), 0n);
      return `${formatUsdc((subtotal + BigInt(majorToMicro(tax)) + BigInt(majorToMicro(service))).toString())} ${currency}`;
    } catch {
      return "—";
    }
  }, [currency, items, service, tax]);

  const clearPhoto = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPreviewUrl(null);
    setPhotoName(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const nextUrl = URL.createObjectURL(file);
    previewRef.current = nextUrl;
    setPreviewUrl(nextUrl);
    setPhotoName(file.name.slice(0, 80));
  };

  const loadSample = () => {
    setMerchant("River Cafe");
    setCurrency("USDC");
    setItems([
      { id: "coffee", label: "Coffee", amount: "6" },
      { id: "cake", label: "Cake", amount: "3" },
    ]);
    setTax("0.9");
    setService("0.45");
    setParticipants([
      { id: "ana", displayName: "Ana", detail: "You" },
      { id: "dave_home", displayName: "Dave", detail: "Home" },
      { id: "dave_work", displayName: "Dave", detail: "Work" },
    ]);
    setAssignments({ coffee: ["ana", "dave_home"], cake: ["dave_work"] });
    setChecked(false);
    setDraft(null);
    setPreparedAt(null);
    setError(null);
  };

  const updateItem = (id: string, patch: Partial<EditableItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    invalidate();
  };

  const toggleAssignment = (itemId: string, participantId: string) => {
    setAssignments((current) => {
      const selected = current[itemId] ?? [];
      return {
        ...current,
        [itemId]: selected.includes(participantId)
          ? selected.filter((id) => id !== participantId)
          : [...selected, participantId],
      };
    });
    invalidate();
  };

  const buildSplit = () => {
    try {
      const itemValues = items.map((item) => ({
        id: item.id,
        label: item.label,
        amountMicro: majorToMicro(item.amount),
      }));
      const subtotalMicro = itemValues.reduce((sum, item) => sum + BigInt(item.amountMicro), 0n).toString();
      const taxMicro = majorToMicro(tax);
      const serviceMicro = majorToMicro(service);
      const totalMicro = (BigInt(subtotalMicro) + BigInt(taxMicro) + BigInt(serviceMicro)).toString();
      const nextDraft = createReceiptObligationDraft({
        candidate: {
          version: "convey.receipt-candidate.v1",
          sourceId: previewUrl ? "photo_receipt" : "manual_receipt",
          merchantLabel: merchant,
          currency,
          items: itemValues,
          subtotalMicro,
          taxMicro,
          serviceMicro,
          totalMicro,
          confidence: 1,
          requiresUserConfirmation: true,
        },
        participants: participants.map(({ id, displayName }) => ({ id, displayName })),
        assignments: items.map((item) => ({
          itemId: item.id,
          participantIds: assignments[item.id] ?? [],
        })),
        userConfirmedCandidate: checked,
      });
      setDraft(nextDraft);
      setPreparedAt(null);
      setError(null);
    } catch (cause) {
      setDraft(null);
      setError(cause instanceof Error ? cause.message : "Check the receipt details and try again.");
    }
  };

  const prepareRequests = () => {
    if (!draft) return;
    setPreparedAt(Date.now());
    setDraft({
      ...draft,
      obligations: draft.obligations.map((obligation) => applyObligationEvent(
        applyObligationEvent(obligation, { type: "confirm" }),
        { type: "request" },
      )),
    });
  };

  const acknowledgeReply = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      obligations: draft.obligations.map((obligation) => applyObligationEvent(
        obligation,
        { type: "chat_acknowledged" },
      )),
    });
  };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[680px] overflow-hidden rounded-[24px] border border-black/10 bg-white shadow-[0_24px_70px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-black/8 bg-black p-5 text-white sm:p-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Add the receipt</p>
          <h3 className="mt-2 text-[25px] font-medium tracking-[-0.04em]">Turn one bill into clear requests.</h3>
          <p className="mt-2 max-w-[480px] text-xs leading-5 text-white/58">Add a photo for reference or enter the details yourself. You approve every line before the split is built.</p>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black"><DocumentText size={18} /></span>
      </div>

      <div className="space-y-6 p-4 sm:p-6">
        <section aria-labelledby="receipt-photo-heading">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p id="receipt-photo-heading" className="text-sm font-semibold text-black">Receipt photo</p>
              <p className="mt-1 text-[11px] text-black/45">The preview stays on this screen.</p>
            </div>
            <button type="button" onClick={loadSample} className="min-h-10 rounded-full border border-black/12 px-4 text-xs font-semibold text-black transition hover:border-black active:scale-[0.98]">Use sample receipt</button>
          </div>

          <AnimatePresence mode="wait">
            {previewUrl ? (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-2xl bg-[#f3f3f1] p-3">
                <div role="img" aria-label="Receipt preview" className="h-24 rounded-xl bg-cover bg-center grayscale" style={{ backgroundImage: `url("${previewUrl}")` }} />
                <div className="flex min-w-0 flex-col justify-between py-1">
                  <div>
                    <p className="truncate text-sm font-medium text-black">{photoName}</p>
                    <p className="mt-1 text-[11px] leading-5 text-black/52">Photo added. Enter the receipt details below.</p>
                  </div>
                  <button type="button" onClick={clearPhoto} className="inline-flex min-h-9 w-fit items-center gap-1.5 text-xs font-semibold text-black"><Trash size={14} />Remove photo</button>
                </div>
              </motion.div>
            ) : (
              <motion.label key="chooser" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex min-h-24 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-black/20 bg-[#fafaf8] px-4 text-center transition hover:border-black/50">
                <span>
                  <span className="block text-sm font-semibold text-black">Choose receipt photo</span>
                  <span className="mt-1 block text-[11px] text-black/43">JPG, PNG or camera capture</span>
                </span>
                <input ref={fileInput} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Choose receipt photo" onChange={(event) => choosePhoto(event.target.files?.[0])} />
              </motion.label>
            )}
          </AnimatePresence>
        </section>

        <section aria-labelledby="receipt-details-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p id="receipt-details-heading" className="text-sm font-semibold text-black">Receipt details</p>
            <span className="text-sm font-semibold tracking-[-0.02em] text-black">{displayTotal}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
            <label className="rounded-xl border border-black/10 px-3 py-2 focus-within:border-black/40">
              <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-black/38">Merchant</span>
              <input aria-label="Merchant" value={merchant} onChange={(event) => { setMerchant(event.target.value); invalidate(); }} placeholder="Restaurant name" className="mt-1 w-full bg-transparent text-sm outline-none" />
            </label>
            <label className="rounded-xl border border-black/10 px-3 py-2 focus-within:border-black/40">
              <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-black/38">Currency</span>
              <select aria-label="Currency" value={currency} onChange={(event) => { setCurrency(event.target.value as "SUI" | "USDC"); invalidate(); }} className="mt-1 w-full bg-transparent text-sm outline-none">
                <option value="USDC">USDC</option>
                <option value="SUI">SUI</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_104px_36px] gap-2">
                <label className="rounded-xl border border-black/10 px-3 py-2 focus-within:border-black/40">
                  <span className="sr-only">Item {index + 1}</span>
                  <input aria-label={`Item ${index + 1}`} value={item.label} onChange={(event) => updateItem(item.id, { label: event.target.value })} placeholder={`Item ${index + 1}`} className="w-full bg-transparent text-sm outline-none" />
                </label>
                <label className="rounded-xl border border-black/10 px-3 py-2 focus-within:border-black/40">
                  <span className="sr-only">{item.label || `Item ${index + 1}`} amount</span>
                  <input aria-label={`${item.label || `Item ${index + 1}`} amount`} inputMode="decimal" value={item.amount} onChange={(event) => updateItem(item.id, { amount: event.target.value })} placeholder="0.00" className="w-full bg-transparent text-right text-sm outline-none" />
                </label>
                <button type="button" aria-label={`Remove ${item.label || `item ${index + 1}`}`} disabled={items.length === 1} onClick={() => { setItems((current) => current.filter((entry) => entry.id !== item.id)); setAssignments((current) => { const next = { ...current }; delete next[item.id]; return next; }); invalidate(); }} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 text-black/45 disabled:opacity-25"><Trash size={14} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => { const id = `item_${itemCounter.current++}`; setItems((current) => [...current, { id, label: "", amount: "" }]); invalidate(); }} className="inline-flex min-h-9 items-center gap-1.5 text-xs font-semibold text-black"><Add size={15} />Add item</button>

          <div className="grid grid-cols-2 gap-2">
            <label className="rounded-xl border border-black/10 px-3 py-2 focus-within:border-black/40">
              <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-black/38">Tax</span>
              <input aria-label="Tax" inputMode="decimal" value={tax} onChange={(event) => { setTax(event.target.value); invalidate(); }} className="mt-1 w-full bg-transparent text-sm outline-none" />
            </label>
            <label className="rounded-xl border border-black/10 px-3 py-2 focus-within:border-black/40">
              <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-black/38">Service</span>
              <input aria-label="Service" inputMode="decimal" value={service} onChange={(event) => { setService(event.target.value); invalidate(); }} className="mt-1 w-full bg-transparent text-sm outline-none" />
            </label>
          </div>
        </section>

        <section aria-labelledby="people-heading" className="space-y-3 border-t border-black/8 pt-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2"><People size={17} /><p id="people-heading" className="text-sm font-semibold text-black">Who shared it?</p></div>
            <button type="button" onClick={() => { const index = participantCounter.current++; setParticipants((current) => [...current, { id: `person_${index}`, displayName: "", detail: `Person ${index}` }]); invalidate(); }} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-black"><Add size={14} />Add person</button>
          </div>

          {duplicateNames.map(({ label, count }) => (
            <div key={label.toLocaleLowerCase("en-US")} className="flex items-start gap-2 rounded-xl bg-[#f3f3f1] px-3 py-2.5 text-[11px] leading-5 text-black/62"><Warning2 size={15} className="mt-0.5 shrink-0" /><span>{count} people named {label}. Choose the right one for each item.</span></div>
          ))}

          <div className="grid gap-2 sm:grid-cols-2">
            {participants.map((participant, index) => (
              <div key={participant.id} className="flex items-center gap-2 rounded-xl border border-black/10 p-2">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-white">{participant.displayName.trim().slice(0, 1).toUpperCase() || index + 1}</span>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Person {index + 1} name</span>
                  <input aria-label={`Person ${index + 1} name`} value={participant.displayName} onChange={(event) => { const displayName = event.target.value; setParticipants((current) => current.map((entry) => entry.id === participant.id ? { ...entry, displayName } : entry)); invalidate(); }} placeholder="Name" className="w-full bg-transparent text-sm font-medium outline-none" />
                  <span className="block truncate text-[10px] text-black/38">{participant.detail}</span>
                </label>
                <button type="button" aria-label={`Remove ${participant.displayName || `person ${index + 1}`}`} disabled={participants.length === 1} onClick={() => { setParticipants((current) => current.filter((entry) => entry.id !== participant.id)); setAssignments((current) => Object.fromEntries(Object.entries(current).map(([itemId, ids]) => [itemId, ids.filter((id) => id !== participant.id)]))); invalidate(); }} className="inline-flex h-8 w-8 items-center justify-center text-black/35 disabled:opacity-20"><Trash size={13} /></button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {items.map((item) => (
              <fieldset key={item.id} className="rounded-2xl bg-[#fafaf8] p-3">
                <legend className="px-1 text-xs font-semibold text-black">{item.label || "Untitled item"}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {participants.map((participant) => {
                    const selected = (assignments[item.id] ?? []).includes(participant.id);
                    return (
                      <label key={participant.id} className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${selected ? "border-black bg-black text-white" : "border-black/12 bg-white text-black"}`}>
                        <input type="checkbox" className="sr-only" checked={selected} onChange={() => toggleAssignment(item.id, participant.id)} aria-label={`${item.label || "Item"} · ${participant.displayName} · ${participant.detail}`} />
                        {selected && <TickCircle size={13} />}{participant.displayName || "Unnamed"} · {participant.detail}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        <section className="border-t border-black/8 pt-5">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 p-3.5">
            <input type="checkbox" checked={checked} onChange={(event) => { setChecked(event.target.checked); setDraft(null); setError(null); }} aria-label="I checked these details" className="mt-0.5 h-4 w-4 accent-black" />
            <span><span className="block text-sm font-semibold text-black">I checked these details</span><span className="mt-1 block text-[11px] leading-5 text-black/48">The photo and entered amounts are not treated as correct until you confirm them.</span></span>
          </label>
          {error && <p role="alert" className="mt-3 rounded-xl bg-black px-3 py-2.5 text-xs text-white">{error}</p>}
          <button type="button" disabled={!checked} onClick={buildSplit} className="mt-3 min-h-12 w-full rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0 active:scale-[0.99]">Build split</button>
        </section>

        <AnimatePresence>
          {draft && (
            <motion.section data-testid="receipt-obligation-summary" initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="overflow-hidden rounded-[20px] bg-black text-white">
              <div className="flex items-start justify-between gap-4 border-b border-white/12 p-4 sm:p-5">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42">Split ready</p><p className="mt-2 text-2xl font-medium tracking-[-0.04em]">{formatUsdc(draft.totalAllocatedMicro)} {currency}</p><p className="mt-1 text-[11px] text-white/48">Balanced to receipt · nothing paid</p></div>
                <TickCircle size={22} />
              </div>
              <div className="divide-y divide-white/10">
                {draft.obligations.map((obligation) => {
                  const participant = participants.find((entry) => entry.id === obligation.participantId);
                  const shareLabel = participant && !["Personal", "You"].includes(participant.detail)
                    ? `${obligation.participantLabel} · ${participant.detail}`
                    : obligation.participantLabel;
                  const share = obligation.state !== "draft" && preparedAt !== null && BigInt(obligation.amountMicro) > 0n
                    ? createReceiptSplitShare({
                      origin: window.location.origin,
                      participant: shareLabel,
                      amountMicro: obligation.amountMicro,
                      asset: obligation.currency,
                      note: `${draft.merchantLabel} receipt split`,
                      createdAt: preparedAt,
                      expiresAt: preparedAt + REQUEST_LIFETIME_MS,
                    })
                    : null;
                  return (
                    <div key={obligation.id} className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-center justify-between gap-4">
                        <div><p className="text-sm font-medium">{shareLabel}</p><p className="mt-0.5 text-[10px] text-white/42">Share + tax + service</p></div>
                        <div className="text-right"><p className="text-sm font-semibold">{formatUsdc(obligation.amountMicro)} {obligation.currency}</p><p data-testid="obligation-state" className="mt-0.5 text-[10px] text-white/48">{stateLabel(obligation.state)}</p>{obligation.state === "settled" && <span data-testid="settled-obligation" />}</div>
                      </div>
                      {share && (
                        <a
                          href={share.whatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Send ${shareLabel} on WhatsApp`}
                          className="mt-3 flex min-h-11 w-full items-center justify-between rounded-full bg-white px-4 text-xs font-semibold text-black transition hover:-translate-y-0.5 active:scale-[0.99]"
                        >
                          <span>Send on WhatsApp</span>
                          <Send2 size={16} />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
                {draft.obligations.every((obligation) => obligation.state === "draft") ? (
                  <button type="button" onClick={prepareRequests} className="min-h-11 rounded-full bg-white px-4 text-xs font-semibold text-black sm:col-span-2">Prepare requests</button>
                ) : (
                  <>
                    <button type="button" onClick={acknowledgeReply} className="min-h-11 rounded-full bg-white px-4 text-xs font-semibold text-black">Mark reply seen</button>
                    <span className="flex min-h-11 items-center justify-center rounded-full border border-white/14 px-4 text-center text-[10px] text-white/48">A reply is not a payment</span>
                  </>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

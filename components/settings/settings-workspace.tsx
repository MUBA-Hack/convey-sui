"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Code1, ShieldTick, Wallet } from "@/components/icons";

const STORAGE_KEY = "convey.settings.v1";
type Settings = { asset: "USDC" | "SUI"; currency: "MYR" | "USD" | "PHP"; qrHome: "scan" | "create"; paymentAlerts: boolean; rememberPeople: boolean; lowData: boolean };
const DEFAULTS: Settings = { asset: "USDC", currency: "MYR", qrHome: "scan", paymentAlerts: true, rememberPeople: true, lowData: false };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-7 w-12 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black ${checked ? "border-black bg-black" : "border-black/15 bg-white"}`}><span className={`absolute top-1 h-[18px] w-[18px] rounded-full transition-transform ${checked ? "translate-x-[22px] bg-white" : "translate-x-1 bg-black/35"}`} /></button>;
}

export function SettingsWorkspace() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const raw = window.localStorage.getItem(STORAGE_KEY); if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) as Partial<Settings> }); } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function update(next: Partial<Settings>) {
    const value = { ...settings, ...next };
    setSettings(value);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); setSaved(true); window.setTimeout(() => setSaved(false), 1400); } catch { setSaved(false); }
  }

  return <main className="cv-shell mx-auto w-full max-w-[920px] px-4 py-8 sm:py-12">
    <header className="max-w-2xl"><h1 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Settings</h1><p className="mt-3 text-sm leading-6 text-neutral-600">Choose how Convey prepares payments on this device. Wallet approval remains required.</p><p aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-neutral-500">{saved ? "Saved on this device" : ""}</p></header>
    <div className="mt-7 grid gap-4 lg:grid-cols-2">
      <section className="border border-black/10 bg-white p-5" aria-labelledby="settings-money"><div className="flex items-center gap-3"><Wallet size={20} /><h2 id="settings-money" className="text-xl font-semibold">Money</h2></div><label className="mt-6 block text-xs font-medium">Preferred asset<select value={settings.asset} onChange={(event) => update({ asset: event.target.value as Settings["asset"] })} className="mt-2 min-h-12 w-full border border-black/12 bg-white px-3"><option>USDC</option><option>SUI</option></select></label><label className="mt-4 block text-xs font-medium">Home currency<select value={settings.currency} onChange={(event) => update({ currency: event.target.value as Settings["currency"] })} className="mt-2 min-h-12 w-full border border-black/12 bg-white px-3"><option>MYR</option><option>USD</option><option>PHP</option></select></label></section>
      <section className="border border-black/10 bg-white p-5" aria-labelledby="settings-qr"><div className="flex items-center gap-3"><Code1 size={20} /><h2 id="settings-qr" className="text-xl font-semibold">QR payments</h2></div><label className="mt-6 block text-xs font-medium">Open QR workspace on<select value={settings.qrHome} onChange={(event) => update({ qrHome: event.target.value as Settings["qrHome"] })} className="mt-2 min-h-12 w-full border border-black/12 bg-white px-3"><option value="scan">Scan</option><option value="create">Create a code</option></select></label><Link href="/qr-ferry" className="mt-4 flex min-h-12 items-center justify-between border border-black/10 px-3 text-sm font-medium">Open scan and pay <ArrowRight size={16} /></Link></section>
      <section className="border border-black/10 bg-white p-5 lg:col-span-2" aria-labelledby="settings-privacy"><div className="flex items-center gap-3"><ShieldTick size={20} /><h2 id="settings-privacy" className="text-xl font-semibold">Privacy and alerts</h2></div><div className="mt-5 grid gap-1 sm:grid-cols-3">{[
        ["Payment alerts", "Status changes and receipts", settings.paymentAlerts, (value: boolean) => update({ paymentAlerts: value })],
        ["Remember people", "Keep saved contacts on this device", settings.rememberPeople, (value: boolean) => update({ rememberPeople: value })],
        ["Low data mode", "Prefer lighter media and fewer effects", settings.lowData, (value: boolean) => update({ lowData: value })],
      ].map(([label, detail, checked, change]) => <div key={String(label)} className="flex min-h-24 items-center justify-between gap-4 border-b border-black/8 p-3 sm:border-b-0 sm:border-r last:border-0"><span><strong className="block text-sm">{String(label)}</strong><small className="mt-1 block text-[11px] leading-4 text-neutral-500">{String(detail)}</small></span><Toggle checked={Boolean(checked)} onChange={change as (value: boolean) => void} label={String(label)} /></div>)}</div></section>
    </div>
  </main>;
}

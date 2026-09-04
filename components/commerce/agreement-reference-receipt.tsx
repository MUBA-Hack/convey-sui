import { ExportSquare, ShieldTick } from "@/components/icons";
import { SheetDisclosure } from "@/components/remittance/sheet-disclosure";
import {
  AGREEMENT_REFERENCE,
  type AgreementFactRow,
  type AgreementLink,
} from "@/lib/remittance/agreement-reference";

/**
 * Public reference receipt for one real, completed protected agreement on Sui
 * testnet. Presentation only: the data module owns every identifier and truth
 * label, and this component never claims more than a record states. Blocked
 * examples render their explicit not-submitted note and carry no explorer
 * link, so a rule description can never read as an on-chain refusal.
 */

function ExternalLink({ link }: { link: AgreementLink }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-black/15 px-4 text-xs font-semibold text-black transition hover:border-black/45 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
    >
      {link.label}
      <ExportSquare size="13" variant="Linear" aria-hidden="true" />
    </a>
  );
}

function FactRow({ row }: { row: AgreementFactRow }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-neutral-500">{row.label}</dt>
      <dd className="min-w-0">
        <span className="block break-all font-mono text-xs leading-5 text-black">
          {row.value}
        </span>
        {row.href ? (
          <a
            href={row.href}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-black underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {row.linkLabel ?? "View"}
            <ExportSquare size="12" variant="Linear" aria-hidden="true" />
          </a>
        ) : null}
      </dd>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <header>
      <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-xl tracking-[-0.025em] text-black">{title}</h2>
      {lead ? <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">{lead}</p> : null}
    </header>
  );
}

export function AgreementReferenceReceipt() {
  const ref = AGREEMENT_REFERENCE;
  return (
    <div data-testid="agreement-reference" className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <span className="inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-3 py-1 font-narrow text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-700">
        <ShieldTick size="14" variant="Linear" aria-hidden="true" />
        {ref.eyebrow}
      </span>
      <h1 className="mt-4 text-4xl font-normal tracking-[-0.05em] text-black sm:text-5xl">
        {ref.title}
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">
        {ref.intro}
      </p>

      {/* Outcome first: the finished result, then the plain summary. */}
      <div
        data-testid="agreement-outcome-stage"
        className="mt-10 rounded-2xl bg-black p-5 text-white sm:p-6"
      >
        <p className="font-narrow text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
          {ref.outcome.stageEyebrow}
        </p>
        <p className="mt-3 text-[44px] font-medium leading-[0.92] tracking-[-0.04em] sm:text-[56px]">
          {ref.outcome.amountNumber}
          <span className="ml-2 align-baseline text-[16px] font-semibold uppercase tracking-[0.16em] text-white/60 sm:text-[18px]">
            {ref.outcome.amountUnit}
          </span>
        </p>
        <p className="mt-3 text-xs leading-5 text-white/70">{ref.outcome.stageCaption}</p>
      </div>

      <section aria-labelledby="agreement-what-happened" className="mt-10">
        <SectionHeading
          eyebrow="Outcome"
          title={ref.outcome.summaryTitle}
        />
        <p
          data-testid="agreement-summary"
          className="mt-3 max-w-xl text-sm leading-6 text-neutral-600"
        >
          {ref.outcome.summary}
        </p>
      </section>

      {/* Gate pipeline: each row is one check, its result, and what it means. */}
      <section aria-labelledby="agreement-why-allowed" className="mt-10 border-t border-black/10 pt-8">
        <span id="agreement-why-allowed" className="sr-only">
          Why it was allowed
        </span>
        <SectionHeading eyebrow="Why it was allowed" title="Checked before the wallet opened." />
        <ul data-testid="agreement-gates" className="mt-4">
          {ref.gates.map((gate) => (
            <li
              key={gate.gate}
              className="grid gap-1 border-b border-black/8 py-3.5 last:border-b-0 sm:grid-cols-[11rem_7rem_minmax(0,1fr)] sm:items-baseline sm:gap-3"
            >
              <span className="text-sm font-semibold text-black">{gate.gate}</span>
              <span className="font-narrow text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {gate.result}
              </span>
              <span className="text-sm leading-6 text-neutral-600">{gate.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* What the contract enforced: real objects and transactions only. */}
      <section aria-labelledby="agreement-enforced" className="mt-10 border-t border-black/10 pt-8">
        <span id="agreement-enforced" className="sr-only">
          What Sui enforced
        </span>
        <SectionHeading eyebrow="What Sui enforced" title="The contract held the money." lead={ref.enforcement.lead} />
        <dl data-testid="agreement-enforcement" className="mt-4 space-y-3 border-y border-black/10 py-4">
          {ref.enforcement.rows.map((row) => (
            <FactRow key={row.label} row={row} />
          ))}
        </dl>
        <p className="mt-3 text-xs leading-5 text-neutral-500">{ref.enforcement.refundNote}</p>
      </section>

      {/* Progressive disclosure: private evidence and independent checks. */}
      <div className="mt-8 rounded-2xl border border-black/10 bg-white">
        <SheetDisclosure label="Private evidence" triggerTestId="agreement-privacy-trigger">
          <p data-testid="agreement-privacy-lead" className="pt-2 text-sm leading-6 text-neutral-600">
            {ref.privacy.lead}
          </p>
          <dl className="mt-4 space-y-3">
            {ref.privacy.rows.map((row) => (
              <FactRow key={row.label} row={row} />
            ))}
          </dl>
        </SheetDisclosure>
        <SheetDisclosure label="Check it yourself" triggerTestId="agreement-verify-trigger">
          <p data-testid="agreement-verify-lead" className="pt-2 text-sm leading-6 text-neutral-600">
            {ref.verify.lead}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 pb-1">
            {ref.verify.links.map((link) => (
              <ExternalLink key={link.label} link={link} />
            ))}
          </div>
        </SheetDisclosure>
      </div>

      {/* Safety boundaries: one completed outcome, two rule previews that were
          never submitted, and the product-versus-contract distinction. */}
      <section aria-labelledby="agreement-safety-title" className="mt-10 border-t border-black/10 pt-8">
        <SectionHeading
          eyebrow={ref.safety.eyebrow}
          title="Where the line sits."
          lead={ref.safety.lead}
        />
        <ul data-testid="agreement-safety" className="mt-4 divide-y divide-black/10">
          {ref.safety.records.map((record) => (
            <li
              key={record.headline}
              data-testid="agreement-safety-record"
              data-status={record.status}
              className="py-5 first:pt-0 last:pb-0"
            >
              <span
                className={
                  record.status === "completed"
                    ? "inline-flex items-center rounded-full bg-black px-3 py-1 font-narrow text-[10px] font-semibold uppercase tracking-[0.16em] text-white"
                    : "inline-flex items-center rounded-full border border-black/15 px-3 py-1 font-narrow text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-600"
                }
              >
                {record.statusLabel}
              </span>
              <h3 className="mt-3 text-lg tracking-[-0.02em] text-black">{record.headline}</h3>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-neutral-600">{record.detail}</p>
              <p
                data-testid="agreement-safety-note"
                className="mt-2 text-xs leading-5 text-neutral-500"
              >
                {record.note}
              </p>
              {record.links.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {record.links.map((link) => (
                    <ExternalLink key={link.label} link={link} />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <p
          data-testid="agreement-safety-summary"
          className="mt-6 rounded-lg border border-black/10 bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-600"
        >
          {ref.safety.summary}
        </p>
      </section>
    </div>
  );
}

interface ProofRejectionCardProps {
  title: string;
  errors: string[];
}

export function ProofRejectionCard({ title, errors }: ProofRejectionCardProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-2xl border border-black/15 bg-white p-6 sm:p-8"
    >
      <h2 className="text-2xl tracking-[-0.035em] text-black">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        No proof claim is made because these checks failed:
      </p>
      <ul className="mt-5 space-y-2">
        {errors.map((error) => (
          <li
            key={error}
            className="rounded-lg border border-black/15 bg-neutral-50 px-3 py-2.5 font-mono text-xs leading-5 text-black"
          >
            {error}
          </li>
        ))}
      </ul>
    </div>
  );
}

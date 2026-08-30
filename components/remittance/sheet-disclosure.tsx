"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowRight2 } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * A small reusable monochrome disclosure — a hairline row with an uppercase
 * label and a chevron that rotates 90° when open, and a panel beneath. Used by
 * the quote settlement sheet and the checkout dialog's "Transfer details" so
 * the collapsed technical fields stay below the primary action and the open
 * transition is one shared, reduced-motion-safe primitive.
 */
export interface SheetDisclosureProps {
  label: string;
  /** Test id applied to the trigger button for DOM tests. */
  triggerTestId?: string;
  children: ReactNode;
  className?: string;
}

export function SheetDisclosure({
  label,
  triggerTestId,
  children,
  className,
}: SheetDisclosureProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("border-t border-black/8", className)}>
      <button
        type="button"
        data-hit-target="true"
        data-testid={triggerTestId}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600 transition-colors hover:bg-neutral-50"
      >
        <span>{label}</span>
        <ArrowRight2
          size={14}
          variant="Linear"
          className={cn(
            "shrink-0 text-neutral-400 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div id={id} className="cv-disclosure-panel px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  );
}

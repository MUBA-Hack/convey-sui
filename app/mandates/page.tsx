import type { Metadata } from "next";
import { RecurringCapBuilder } from "@/components/mandates/recurring-cap-builder";

export const metadata: Metadata = {
  title: "Mandates | Convey",
  description:
    "Set a funded recurring spending cap with strict per-collection, lifetime, interval, and expiry limits.",
};

export default function MandatesPage() {
  return <RecurringCapBuilder />;
}

import type { Metadata } from "next";
import { PayWorkspace } from "@/components/commerce/pay-workspace";

export const metadata: Metadata = {
  title: "Pay — Convey",
  description: "Send money nearby or abroad with a clear quote and user-approved settlement.",
};

export default function PayPage() {
  return <PayWorkspace />;
}

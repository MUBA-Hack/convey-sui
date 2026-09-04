/**
 * Activity list is device-local navigation, never proof. The receipt
 * verifier owns chain status. Local records therefore use one nav line
 * regardless of stored `status`.
 */
export const ACTIVITY_PAGE_COPY = {
  eyebrow: "Activity",
  title: "Recent transfers.",
  intro: "Open a transfer to review its latest receipt.",
  emptyTitle: "No transfers on this device yet.",
  emptyBody: "Send money home, then come back to open the receipt from here.",
  sendMoney: "Send money",
  openExample: "Open a verified example",
  openReceipt: "Open receipt",
  listCaveat: "Saved on this device. Open to check current status.",
  savedPlanPrefix: "Saved plan",
} as const;

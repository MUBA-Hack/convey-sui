import { NextResponse } from "next/server";
import { fetchPublicGonkaReceipt } from "@/lib/gonka/public-receipt";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const { requestId } = await context.params;
    const receipt = await fetchPublicGonkaReceipt(requestId);
    return NextResponse.json(receipt, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "receipt_unavailable" }, { status: 404 });
  }
}

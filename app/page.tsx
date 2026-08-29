import { CommerceChat } from "@/components/commerce/commerce-chat";

/**
 * The home route is the Convey commerce experience.
 *
 * Per the locked product rules, "/" is the chat-first purchase surface. The
 * legacy console routes remain reachable from the site header. The
 * CommerceChat submits free text (typed or spoken) to the typed
 * `/api/commerce/intent` endpoint and renders the response in a thread with an
 * inline preview, clarification, error recovery, and a cancel/reopen confirm
 * gate that opens a checkout dialog. No transaction is built on this route.
 *
 * The wrapper provides the soft warm-gray page ground the monochrome commerce
 * shell sits on; the chat panel, context rail, empty state and composer live
 * inside `CommerceChat`.
 */
export default function HomePage() {
  return (
    <div className="cv-shell__ground flex min-h-[calc(100vh-60px)] flex-col">
      <CommerceChat />
    </div>
  );
}

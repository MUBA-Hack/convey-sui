const baseUrl = process.env.CONVEY_CANARY_URL ?? "http://127.0.0.1:3000";

const response = await fetch(`${baseUrl}/api/remittance/quote`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    text: "Hantar RM500 to Ana in Manila for school supplies; jangan lebih RM520.",
  }),
});

if (!response.ok) {
  throw new Error(`Remittance route returned HTTP ${response.status}.`);
}

const quote = await response.json();
const review = quote?.intentReview;

if (
  quote?.kind !== "quote" ||
  review?.reviewer !== "gonka" ||
  review?.provider !== "gonkarouter" ||
  typeof review?.requestId !== "string" ||
  review.requestId.length === 0 ||
  typeof review?.responseModel !== "string" ||
  review.responseModel.length === 0
) {
  const reason = review?.fallbackReason ?? "invalid live-review response";
  throw new Error(`Gonka live canary did not reach the live review path: ${reason}.`);
}

const serialized = JSON.stringify(quote);
if (/api[_-]?key|authorization|bearer|sk-/i.test(serialized)) {
  throw new Error("The public quote response contains credential-shaped data.");
}

console.log(
  JSON.stringify({
    status: "live",
    reviewer: review.reviewer,
    provider: review.provider,
    requestId: review.requestId,
    responseModel: review.responseModel,
    detectedLanguage: review.detectedLanguage,
    ruleStatus: review.ruleStatus,
  }),
);

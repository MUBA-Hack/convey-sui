/**
 * Shared share/export helpers for remittance and commerce receipt proof
 * documents. Both the confirmed-settlement receipt actions and the proof
 * verifier use these so the clipboard/download behavior is identical and
 * there is no duplicated DOM/Blob logic.
 */

/**
 * Copy a share URL for an encoded receipt payload to the clipboard. Falls
 * back to replacing the URL query string when the clipboard API is
 * unavailable (e.g. insecure context). Returns true if the clipboard write
 * succeeded.
 */
export async function copyReceiptUrl(
  payload: string,
  queryParam: string,
): Promise<boolean> {
  const url = `${window.location.origin}/proof?${queryParam}=${payload}`;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    window.history.replaceState({}, "", `/proof?${queryParam}=${payload}`);
    return false;
  }
}

/**
 * Trigger a browser download of a receipt document as pretty-printed JSON.
 * Creates a temporary object URL and anchor, clicks it, then revokes the URL.
 */
export function exportReceiptJson(
  receipt: unknown,
  filename: string,
): void {
  const json = JSON.stringify(receipt, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

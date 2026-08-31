// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReceiptSplitAction } from "@/components/remittance/receipt-split-action";

const RECEIPT_URL = "https://example.test/proof?r=abc";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => cleanup());

function row(index: number): HTMLElement {
  return screen.getAllByTestId("split-row")[index]!;
}

describe("ReceiptSplitAction — initial state", () => {
  it("shows the source total and starts with two blank rows", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    expect(screen.getByTestId("split-source-total")).toHaveTextContent("0.0001 USDC");
    expect(screen.getAllByTestId("split-row")).toHaveLength(2);
  });

  it("disables remove at the minimum participant count", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    const removes = screen.getAllByRole("button", { name: /Remove participant/i });
    expect(removes).toHaveLength(2);
    expect(removes.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("ReceiptSplitAction — equal split", () => {
  it("distributes 100 / 2 => 50/50 in USDC decimals", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    const inputs = screen.getAllByTestId("split-allocation-input");
    expect(inputs[0]).toHaveValue("0.00005");
    expect(inputs[1]).toHaveValue("0.00005");
  });

  it("distributes 100 / 3 => 34/33/33 after adding a participant", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Add participant/i }));
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    const inputs = screen.getAllByTestId("split-allocation-input");
    expect(inputs[0]).toHaveValue("0.000034");
    expect(inputs[1]).toHaveValue("0.000033");
    expect(inputs[2]).toHaveValue("0.000033");
  });

  it("caps participants at the maximum and disables add", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Add participant/i }));
    }
    expect(screen.getAllByTestId("split-row")).toHaveLength(8);
    expect(screen.getByRole("button", { name: /Add participant/i })).toBeDisabled();
  });
});

describe("ReceiptSplitAction — name validation", () => {
  it("rejects a blank name with an error", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "   " } });
    expect(within(row(0)).getByText(/Enter a name/i)).toBeInTheDocument();
  });

  it("rejects a duplicate name case-insensitively", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.change(screen.getAllByTestId("split-name-input")[1]!, { target: { value: "ana" } });
    expect(within(row(1)).getByText(/already added/i)).toBeInTheDocument();
  });
});

describe("ReceiptSplitAction — confirm + generate gate", () => {
  it("disables generate until every row is confirmed and the total matches", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.change(screen.getAllByTestId("split-name-input")[1]!, { target: { value: "Marie" } });
    // No confirms yet.
    expect(screen.getByRole("button", { name: /Generate requests/i })).toBeDisabled();
    // Confirm both rows sequentially (each confirm toggles that row to Edit).
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    expect(screen.getByRole("button", { name: /Generate requests/i })).toBeEnabled();
  });

  it("locks a confirmed row and allows editing again", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    expect(screen.getAllByTestId("split-name-input")[0]).toHaveAttribute("readonly");
    // Edit unlocks the row.
    fireEvent.click(screen.getAllByRole("button", { name: /Edit row/i })[0]!);
    expect(screen.getAllByTestId("split-name-input")[0]).not.toHaveAttribute("readonly");
  });

  it("disables generate when an allocation is edited to break the total", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.change(screen.getAllByTestId("split-name-input")[1]!, { target: { value: "Marie" } });
    fireEvent.change(screen.getAllByTestId("split-allocation-input")[0]!, { target: { value: "0.000099" } });
    // 99 + 50 = 149 != 100 -> total mismatch.
    expect(screen.getByRole("button", { name: /Generate requests/i })).toBeDisabled();
    expect(screen.getByTestId("split-total-status")).toHaveTextContent(/do not match/i);
  });
});

describe("ReceiptSplitAction — generated requests", () => {
  it("produces one request per participant with request language and exact amounts", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.change(screen.getAllByTestId("split-name-input")[1]!, { target: { value: "Marie" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Generate requests/i }));
    const requests = screen.getAllByTestId("split-request-message");
    expect(requests).toHaveLength(2);
    expect(requests[0]!.textContent).toContain("Ana");
    expect(requests[0]!.textContent).toContain("0.00005 USDC");
    expect(requests[0]!.textContent).toContain(RECEIPT_URL);
    expect(requests[0]!.textContent).toContain("request");
    expect(requests[0]!.textContent).not.toMatch(/paid/i);
  });

  it("copies a request message to the clipboard", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Split equally/i }));
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.change(screen.getAllByTestId("split-name-input")[1]!, { target: { value: "Marie" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: /Confirm row/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Generate requests/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /Copy request/i })[0]!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(copied).toContain("Ana");
    expect(copied).toContain("request");
  });
});

describe("ReceiptSplitAction — reset", () => {
  it("clears all rows back to two blank rows", () => {
    render(<ReceiptSplitAction usdcMicro="100" receiptUrl={RECEIPT_URL} />);
    fireEvent.click(screen.getByRole("button", { name: /Add participant/i }));
    fireEvent.change(screen.getAllByTestId("split-name-input")[0]!, { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: /Reset split/i }));
    expect(screen.getAllByTestId("split-row")).toHaveLength(2);
    expect(screen.getAllByTestId("split-name-input")[0]).toHaveValue("");
  });
});

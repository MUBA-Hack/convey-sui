// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { QrTaskStudio } from "@/components/commerce/qr-task-studio";

afterEach(cleanup);

describe("QR task studio", () => {
  it("creates an exact personal split and WhatsApp link", () => {
    render(<QrTaskStudio />);
    fireEvent.click(screen.getByRole("button", { name: /SplitCollect by WhatsApp/ }));
    fireEvent.change(screen.getByLabelText("Split amount"), { target: { value: "37.29" } });
    fireEvent.change(screen.getByLabelText("Split participants"), { target: { value: "Maya, Idris, Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Create personal requests" }));

    expect(screen.getByText("12.43 USDC · Dinner")).toBeInTheDocument();
    const share = screen.getByRole("link", { name: "WhatsApp" });
    expect(share).toHaveAttribute("href", expect.stringContaining("https://wa.me/?text="));
    expect(share.getAttribute("href")).toContain("12.43%20USDC");
    expect(screen.getByRole("button", { name: "Idris's share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sam's share" })).toBeInTheDocument();
  });

  it("rejects a receive code without a complete Sui address", () => {
    render(<QrTaskStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Create receive QR" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the Sui address");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("companion responsive shell", () => {
  it("uses a single focused workspace at tablet widths", () => {
    const start = css.indexOf("@media (min-width: 640px) and (max-width: 1023px)");
    const end = css.indexOf("@media (max-width: 900px)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const tablet = css.slice(start, end);
    expect(tablet).toContain(".companion-shell--app .companion-layout");
    expect(tablet).toContain("display: block;");
    expect(tablet).toContain(".companion-shell--app .companion-sidebar { display: none; }");
    expect(tablet).toContain(".companion-mobile-nav");
    expect(tablet).toContain("grid-template-columns: repeat(5, 1fr);");
  });

  it("lets the app workspace replace duplicate site chrome without changing the React tree", () => {
    expect(css).toContain("body:has(.companion-shell--app) .site-header { display: none; }");
  });
});

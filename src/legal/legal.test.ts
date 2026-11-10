import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { LegalPage } from "./LegalPage";

// The page reads the theme from the document; the test environment is plain node.
beforeAll(() => {
  (globalThis as any).document = { documentElement: { dataset: {} } };
});

const render = (slug: "terms" | "privacy") =>
  renderToStaticMarkup(createElement(LegalPage, { slug })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

describe("legal pages", () => {
  for (const slug of ["terms", "privacy"] as const) {
    it(`/${slug} renders the draft marks, date, contact and placeholders`, () => {
      const html = render(slug);
      expect(html).toContain("Draft, beta");
      expect(html).toMatch(/Last updated \w+ \d+, 20\d\d/);
      expect(html).toContain("Pending legal review");
      expect(html).toContain("support@assembly.rsvp");
      expect(html).toContain("[Legal entity name: to be confirmed]");
      expect(html).toContain("[Mailing address: to be confirmed]");
    });
  }

  it("terms state what Assembly does and does not do", () => {
    const html = render("terms");
    expect(html).toContain("18 or older");
    expect(html).toContain("does not sell tickets, hold money, or run events");
    expect(html).toContain("responsible for their events, venues, permits, and safety");
    expect(html).toContain("Tennessee");
    expect(html).toContain("Harm reduction information");
    for (const h of ["Accounts and age", "Your content", "Disclaimers", "Limits on liability", "Ending your use", "Changes"]) expect(html).toContain(h);
  });

  it("privacy matches the product", () => {
    const html = render("privacy");
    expect(html).toContain("don't sell or rent personal data");
    expect(html).toContain("advertising trackers");
    expect(html).toContain("Delete your account");
    expect(html).toContain("never sent to Assembly");
    expect(html).toContain("no private messaging");
  });
});

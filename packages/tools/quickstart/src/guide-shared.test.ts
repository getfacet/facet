import { describe, expect, it } from "vitest";
import {
  QUICKSTART_NAV_ITEMS,
  quickstartCardMarkup,
  quickstartNavigationMarkup,
} from "./guide-shared.js";

describe("quickstart guide markup helpers", () => {
  it("builds one nav button for each seeded screen", () => {
    const markup = quickstartNavigationMarkup();

    for (const item of QUICKSTART_NAV_ITEMS) {
      expect(markup).toContain(`label="${item.label}"`);
      expect(markup).toContain(`action="nav:${item.to}"`);
    }
    expect(markup).not.toContain("local:"); // style-hard-cut: allowed-negative
  });

  it("escapes card text before embedding it in markup attributes", () => {
    expect(quickstartCardMarkup('A "quoted" title', "Use <safe> & bounded text.")).toContain(
      'title="A &quot;quoted&quot; title"',
    );
    expect(quickstartCardMarkup('A "quoted" title', "Use <safe> & bounded text.")).toContain(
      'value="Use &lt;safe&gt; &amp; bounded text."',
    );
  });
});

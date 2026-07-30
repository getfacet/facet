import { describe, expect, it } from "vitest";

import { createMarkupBuffer } from "./buffer.js";

const PAGE = '<Facet entry="home"><Screen name="home"><Text value="Ready" /></Screen></Facet>';
const NEXT = '<Facet entry="home"><Screen name="home"><Text value="Next" /></Screen></Facet>';

describe("createMarkupBuffer", () => {
  it("does not release a partial streamed fragment", () => {
    const buffer = createMarkupBuffer();

    expect(buffer.append('<Facet entry="home">')).toEqual({
      ready: [],
      pending: '<Facet entry="home">',
    });
  });

  it("releases only complete parseable markup units", () => {
    const buffer = createMarkupBuffer();

    expect(buffer.append(PAGE.slice(0, 20)).ready).toEqual([]);
    expect(buffer.append(PAGE.slice(20))).toEqual({ ready: [PAGE], pending: "" });
  });

  it("progressively releases multiple complete calls", () => {
    const buffer = createMarkupBuffer();

    expect(buffer.append(PAGE)).toEqual({ ready: [PAGE], pending: "" });
    expect(buffer.append(NEXT)).toEqual({ ready: [NEXT], pending: "" });
  });
});

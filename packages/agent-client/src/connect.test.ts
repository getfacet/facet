import { describe, expect, it } from "vitest";
import { parseSseFrames } from "./connect.js";

describe("parseSseFrames", () => {
  it("extracts a single complete frame and leaves no rest", () => {
    const { data, rest } = parseSseFrames('data: {"a":1}\n\n');
    expect(data).toEqual(['{"a":1}']);
    expect(rest).toBe("");
  });

  it("returns multiple frames in one buffer", () => {
    const { data } = parseSseFrames("data: one\n\ndata: two\n\n");
    expect(data).toEqual(["one", "two"]);
  });

  it("keeps an incomplete trailing frame as rest", () => {
    const { data, rest } = parseSseFrames("data: done\n\ndata: partial");
    expect(data).toEqual(["done"]);
    expect(rest).toBe("data: partial");
  });

  it("reassembles a frame split across two chunks", () => {
    const first = parseSseFrames("data: hel");
    expect(first.data).toEqual([]);
    const second = parseSseFrames(first.rest + "lo\n\n");
    expect(second.data).toEqual(["hello"]);
  });

  it("ignores non-data lines (comments / heartbeats) without losing following frames", () => {
    const { data } = parseSseFrames(": keep-alive\n\ndata: real\n\n");
    expect(data).toEqual(["real"]);
  });
});

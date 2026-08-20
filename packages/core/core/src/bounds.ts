/**
 * The Facet bounds table (B-01..B-28).
 *
 * `BOUNDS` is the single source every layer imports — core validation, the
 * runtime, the renderer, the agent tools, and the transports. Nothing may
 * restate a limit as a local literal; a bound that exists in two places drifts.
 *
 * Every bound is a **character count or a structural count**. There is
 * deliberately **no token-count limit** anywhere in Facet: bounds must be
 * decidable from the payload itself, without a tokenizer, so they mean the same
 * thing for every model, provider, and runtime.
 */

/** B-21 is one bound with two halves; whichever binds first wins. */
const readDataResult = Object.freeze({
  /** Maximum array items in a `read_data` result. */
  items: 100,
  /** Maximum characters in a `read_data` result. */
  chars: 20_000,
} as const);

export const BOUNDS = Object.freeze({
  /** B-01 — markup source per mutation call, in characters. */
  markupSourceChars: 20_000,
  /** B-02 — nodes created or replaced per mutation call. */
  nodesPerMutation: 500,
  /** B-03 — element nesting depth, for both author markup and the document. */
  elementDepth: 32,
  /** B-04 — props per element. */
  propsPerElement: 32,
  /** B-05 — attribute value length, in characters. */
  attributeValueChars: 2_000,
  /**
   * B-06 — identifier length, in characters. One limit covers tag, prop,
   * screen, event, field and data-segment names.
   */
  identifierChars: 64,
  /** B-07 — nodes per document. */
  nodesPerDocument: 5_000,
  /** B-08 — screens per document. */
  screensPerDocument: 64,
  /** B-09 — components per active catalog. */
  componentsPerCatalog: 256,
  /** B-10 — props per component spec. */
  propsPerComponentSpec: 48,
  /** B-11 — enum values per prop. */
  enumValuesPerProp: 64,
  /** B-12 — component when-to-use text, in characters. */
  componentWhenToUseChars: 200,
  /** B-13 — per-prop guidance text, in characters. */
  propGuidanceChars: 200,
  /** B-14 — data path depth, in segments. */
  dataPathDepth: 8,
  /** B-15 — the resulting complete Data Model as canonical JSON, in characters. */
  dataModelCanonicalJsonChars: 1_000_000,
  /** B-16 — total values in the resulting complete Data Model. */
  dataModelValues: 100_000,
  /** B-17 — array length anywhere in the resulting complete Data Model. */
  dataModelArrayLength: 50_000,
  /** B-18 — object keys per object anywhere in the resulting complete Data Model. */
  dataModelObjectKeys: 256,
  /** B-19 — string value anywhere in the resulting complete Data Model, in characters. */
  dataModelStringChars: 4_000,
  /** B-20 — agent `publish_data` incoming payload, in characters. */
  publishDataPayloadChars: 20_000,
  /** B-21 — `read_data` result: at most `items` array items AND at most `chars` characters. */
  readDataResult,
  /** B-22 — `collect` fields per event. */
  collectFieldsPerEvent: 32,
  /** B-23 — collected value / `arg` length, in characters each. */
  collectedValueChars: 2_000,
  /** B-24 — one framework-controlled UI or error copy string, in characters. */
  frameworkCopyChars: 500,
  /** B-25 — conversation message text, visitor or assistant, in characters. */
  conversationMessageChars: 20_000,
  /** B-26 — records rendered by one data-backed component. */
  renderedCollectionItems: 100,
  /** B-27 — one normalized visitor event as UTF-8 JSON bytes. */
  visitorEventJsonBytes: 4_000_000,
  /** B-28 — one visitor HTTP request body as UTF-8 bytes. */
  visitorRequestBodyBytes: 5 * 1024 * 1024,
} as const);

/** The shape of the frozen bounds table. */
export type Bounds = typeof BOUNDS;

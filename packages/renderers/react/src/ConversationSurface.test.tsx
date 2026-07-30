// @vitest-environment jsdom
/**
 * The proof that assistant prose reaches the visitor as **characters**, that
 * every message keeps its identity, and that the over-length validation message
 * is a conversation message rather than a fourth render neutral state.
 *
 * **Escaping is the claim, and `querySelector("script") === null` is not it.**
 * React would not mount a `<script>` from a text child under any implementation,
 * so that assertion also passes against a component that renders nothing at all.
 * The claim here is two-sided and both sides are asserted: the prose is
 * **present** — the rendered text equals the source string byte for byte,
 * angle brackets and all — and **nothing mounted** — the container's complete
 * element list is exactly the surface's own chrome. `UnescapedControl` renders
 * the same fixture through `dangerouslySetInnerHTML` and is asserted to
 * **violate both**, which is what establishes that the assertions can tell
 * escaped from unescaped rather than passing on an empty page.
 *
 * **Anchors come before claims.** Before asserting that a fixture in some state
 * behaves correctly, the suite asserts the fixture actually reaches that state:
 * the XSS fixture really contains component markup and a script element; the
 * over-length draft really fails `validateVisitorText` while the at-bound draft
 * passes; and a real render neutral state really carries the
 * `data-facet-neutral-state` attribute that the validation-slot test asserts is
 * absent. Without that last one, a misspelled attribute would make the
 * "not a neutral state" claim pass for the wrong reason.
 *
 * **Default and override must be able to fail independently.** A suite that only
 * proved the framework default appears would pass against a surface that ignored
 * the host's override entirely, and one that only proved the override appears
 * would pass against a surface that ignored the defaults. Both are asserted
 * byte-identically and each is additionally asserted **not** to be the other, so
 * a surface that hardcoded either string fails exactly one of them.
 *
 * **What this file does not own.** The surface takes an already-resolved
 * `validationError` string, so the glue that runs `validateVisitorText` and picks
 * `copy.validation.messageTooLong` lives outside it. `localValidationError` below
 * is that glue, written here so the over-length path is exercised end to end
 * through the real Core functions rather than by handing the surface a string a
 * test author typed.
 */

import {
  BOUNDS,
  NEUTRAL_COPY_DEFAULTS,
  deriveMessageId,
  resolveNeutralCopy,
  validateVisitorText,
} from "@facet/core";
import type { ConversationMessage, NeutralCopy } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import * as conversationSurface from "./ConversationSurface.js";
import { ConversationSurface } from "./ConversationSurface.js";
import type { ConversationItem } from "./ConversationSurface.js";
import { PreparingState } from "./fallback.js";

afterEach(cleanup);

/** The DOM markers, written out here rather than imported from the module under test. */
const SURFACE_ATTRIBUTE = "data-facet-conversation";
const MESSAGE_ATTRIBUTE = "data-facet-message-id";
const ROLE_ATTRIBUTE = "data-facet-message-role";
const ERROR_ATTRIBUTE = "data-facet-conversation-error";
const NEUTRAL_STATE_ATTRIBUTE = "data-facet-neutral-state";

/**
 * Prose the brain could plausibly write, carrying both halves of the threat: a
 * component tag from the catalog, and a script that sets a global if it ever
 * runs. A lookalike is the point — a fixture of unrelated words would pass a
 * containment check even against a surface that mounted the markup.
 */
const MARKUP_PROSE =
  'July is up 21%: <Metric value="x" /> has the number. ' +
  "<script>window.__facetEscaped = true;</script> — that is all.";

/** The global the fixture's script would set. Read, never written, by this suite. */
const PWNED_FLAG = "__facetEscaped";

/** A host override for the one validation string, unmistakably not the default. */
const HOST_OVERRIDE = {
  validation: {
    messageTooLong: "Ihre Nachricht ist zu lang. Bitte kürzen Sie sie und versuchen Sie es erneut.",
  },
} as const;

/** Resolves a copy set, failing loudly rather than silently falling back. */
function resolvedCopy(hostOverride?: unknown): NeutralCopy {
  const resolution = resolveNeutralCopy(hostOverride);
  if (!resolution.ok) {
    throw new Error(`the fixture copy must resolve: ${resolution.code}`);
  }
  return resolution.copy;
}

/**
 * The host-side glue between Core's bound and the surface's slot: an unsendable
 * draft answers the resolved copy, a sendable one answers nothing.
 *
 * Neither parameter is defaulted. A default `copy` would let the override test
 * pass against glue that never read the argument, and a default `draft` would
 * swallow the very absence the "no validation error" test is about.
 */
function localValidationError(draft: string, copy: NeutralCopy): string | undefined {
  return validateVisitorText(draft) ? undefined : copy.validation.messageTooLong;
}

/** A draft one character past `B-25`, and one exactly at it. */
const OVER_LONG_DRAFT = "x".repeat(BOUNDS.conversationMessageChars + 1);
const AT_BOUND_DRAFT = "x".repeat(BOUNDS.conversationMessageChars);

/** Two real messages from one turn, with the ids Core derives for them. */
const TURN = "e-01J8Q";
const VISITOR_ITEM: ConversationItem = {
  messageId: deriveMessageId(TURN, "visitor"),
  role: "visitor",
  text: "Show me July and summarize it.",
};
const ASSISTANT_ITEM: ConversationItem = {
  messageId: deriveMessageId(TURN, "assistant"),
  role: "assistant",
  text: "July came in at 23,000,000 — up 21% on June.",
};

/** Every element in the container, as lowercase tag names, in document order. */
function tagNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll("*")].map((element) => element.tagName.toLowerCase());
}

/** The rendered messages, in document order. */
function messageElements(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(`[${MESSAGE_ATTRIBUTE}]`)];
}

/**
 * The same prose rendered **unescaped**, as the negative control.
 *
 * Its only job is to fail the assertions the real surface passes. Without it,
 * "the text is literal and no element mounted" would be a claim with no
 * demonstrated way of coming out false.
 */
function UnescapedControl({ text }: { readonly text: string }): ReactElement {
  return <div dangerouslySetInnerHTML={{ __html: text }} />;
}

describe("assistant prose is rendered as escaped text", () => {
  it("uses a fixture that really carries component markup and a script element", () => {
    expect(MARKUP_PROSE).toContain('<Metric value="x" />');
    expect(MARKUP_PROSE).toContain("<script>");
    expect(MARKUP_PROSE).toContain("</script>");
    expect(MARKUP_PROSE).toContain(PWNED_FLAG);
  });

  it("can tell escaped prose from unescaped: the control violates both halves", () => {
    const { container } = render(<UnescapedControl text={MARKUP_PROSE} />);
    // The text is no longer literal…
    expect(container.textContent).not.toBe(MARKUP_PROSE);
    // …and elements the prose never asked for are on the page.
    expect(container.querySelector("script")).not.toBeNull();
    expect(container.querySelector("metric")).not.toBeNull();
    expect(tagNames(container)).not.toEqual(["div", "div"]);
  });

  it("shows the markup as literal characters, byte for byte", () => {
    const item: ConversationItem = {
      messageId: deriveMessageId("e-XSS", "assistant"),
      role: "assistant",
      text: MARKUP_PROSE,
    };
    const { container } = render(<ConversationSurface items={[item]} />);
    const rendered = messageElements(container);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.textContent).toBe(MARKUP_PROSE);
    expect(container.textContent).toBe(MARKUP_PROSE);
  });

  it("mounts nothing the prose named", () => {
    const item: ConversationItem = {
      messageId: deriveMessageId("e-XSS", "assistant"),
      role: "assistant",
      text: MARKUP_PROSE,
    };
    const { container } = render(<ConversationSurface items={[item]} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("metric")).toBeNull();
    // The complete element list: the surface, and one message. Nothing else.
    expect(tagNames(container)).toEqual(["div", "div"]);
    expect(container.innerHTML).not.toContain("<script");
  });

  it("leaves no global behind — documentation only, see the note", () => {
    // This assertion CANNOT FAIL under jsdom: a <script> inserted through
    // innerHTML never executes there, so it passes against a surface that
    // injects the prose as raw HTML — it was confirmed green against exactly
    // such a stub. The claim is carried by the two tests above (the text is
    // literal, and the element list is exactly the surface's own chrome), both
    // of which that stub failed. This is kept as a tripwire for a future run in
    // an environment that does execute injected scripts, and for no other
    // reason.
    const globals = globalThis as unknown as Record<string, unknown>;
    expect(globals[PWNED_FLAG]).toBeUndefined();
    const item: ConversationItem = {
      messageId: deriveMessageId("e-XSS", "assistant"),
      role: "assistant",
      text: MARKUP_PROSE,
    };
    render(<ConversationSurface items={[item]} />);
    expect(globals[PWNED_FLAG]).toBeUndefined();
  });

  it("escapes a visitor message on the same terms", () => {
    const text = "<script>alert(1)</script>";
    const item: ConversationItem = {
      messageId: deriveMessageId("v-01", "visitor"),
      role: "visitor",
      text,
    };
    const { container } = render(<ConversationSurface items={[item]} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("every message carries its identity", () => {
  it("marks each message with its own messageId, paired with its own text", () => {
    const items = [VISITOR_ITEM, ASSISTANT_ITEM];
    const { container } = render(<ConversationSurface items={items} />);
    const rendered = messageElements(container);
    expect(rendered).toHaveLength(items.length);
    expect(rendered.map((element) => element.getAttribute(MESSAGE_ATTRIBUTE))).toEqual(
      items.map((item) => item.messageId),
    );
    // The pairing, not just the sets: an implementation that stamped every
    // message with the first id would satisfy the list above per element only by
    // accident, and would fail here.
    expect(rendered.map((element) => element.textContent)).toEqual(items.map((item) => item.text));
  });

  it("keeps the two directions of one turn distinct", () => {
    expect(VISITOR_ITEM.messageId).not.toBe(ASSISTANT_ITEM.messageId);
    const { container } = render(<ConversationSurface items={[VISITOR_ITEM, ASSISTANT_ITEM]} />);
    const ids = messageElements(container).map((element) =>
      element.getAttribute(MESSAGE_ATTRIBUTE),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("marks each message with its own role", () => {
    const items = [VISITOR_ITEM, ASSISTANT_ITEM];
    const { container } = render(<ConversationSurface items={items} />);
    expect(
      messageElements(container).map((element) => element.getAttribute(ROLE_ATTRIBUTE)),
    ).toEqual(items.map((item) => item.role));
  });

  it("renders the items in the order it was given, and renders every one", () => {
    const items: ConversationItem[] = ["first", "second", "third"].map((text, index) => ({
      messageId: deriveMessageId(`e-${index}`, "assistant"),
      role: "assistant",
      text,
    }));
    const { container } = render(<ConversationSurface items={items} />);
    expect(messageElements(container).map((element) => element.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("takes a Core ConversationMessage as an item unchanged", () => {
    const message: ConversationMessage = {
      kind: "conversation",
      messageId: deriveMessageId("e-CORE", "assistant"),
      turnId: "e-CORE",
      role: "assistant",
      text: "Delivered after the turn's committed tool calls.",
      at: 0,
    };
    const { container } = render(<ConversationSurface items={[message]} />);
    const rendered = messageElements(container);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.getAttribute(MESSAGE_ATTRIBUTE)).toBe(message.messageId);
    expect(rendered[0]?.textContent).toBe(message.text);
  });

  it("renders an empty conversation as the surface and nothing else", () => {
    const { container } = render(<ConversationSurface items={[]} />);
    expect(container.querySelector(`[${SURFACE_ATTRIBUTE}]`)).not.toBeNull();
    expect(messageElements(container)).toHaveLength(0);
    expect(container.textContent).toBe("");
  });
});

describe("the over-length validation message", () => {
  it("anchors on Core: the over-long draft is rejected and the at-bound one is not", () => {
    expect(OVER_LONG_DRAFT.length).toBe(BOUNDS.conversationMessageChars + 1);
    expect(AT_BOUND_DRAFT.length).toBe(BOUNDS.conversationMessageChars);
    expect(validateVisitorText(OVER_LONG_DRAFT)).toBe(false);
    expect(validateVisitorText(AT_BOUND_DRAFT)).toBe(true);
  });

  it("shows the framework default when the host overrode nothing", () => {
    const copy = resolvedCopy();
    const error = localValidationError(OVER_LONG_DRAFT, copy);
    expect(error).toBe(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong);
    const { container } = render(<ConversationSurface items={[]} validationError={error} />);
    const shown = container.querySelector(`[${ERROR_ATTRIBUTE}]`);
    expect(shown?.textContent).toBe(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong);
    expect(shown?.textContent).not.toBe(HOST_OVERRIDE.validation.messageTooLong);
    // Byte-identical, with nothing added around it.
    expect(container.textContent).toBe(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong);
  });

  it("shows the host's override byte-identically", () => {
    const copy = resolvedCopy(HOST_OVERRIDE);
    const error = localValidationError(OVER_LONG_DRAFT, copy);
    expect(error).toBe(HOST_OVERRIDE.validation.messageTooLong);
    const { container } = render(<ConversationSurface items={[]} validationError={error} />);
    const shown = container.querySelector(`[${ERROR_ATTRIBUTE}]`);
    expect(shown?.textContent).toBe(HOST_OVERRIDE.validation.messageTooLong);
    expect(shown?.textContent).not.toBe(NEUTRAL_COPY_DEFAULTS.validation.messageTooLong);
    expect(container.textContent).toBe(HOST_OVERRIDE.validation.messageTooLong);
  });

  it("shows nothing when the draft is within the bound", () => {
    const copy = resolvedCopy(HOST_OVERRIDE);
    const error = localValidationError(AT_BOUND_DRAFT, copy);
    expect(error).toBeUndefined();
    const { container } = render(<ConversationSurface items={[ASSISTANT_ITEM]} />);
    expect(container.querySelector(`[${ERROR_ATTRIBUTE}]`)).toBeNull();
    // Not merely "no marker": no validation copy anywhere on the page.
    expect(container.textContent).toBe(ASSISTANT_ITEM.text);
  });

  it("escapes the validation copy like any other text", () => {
    const hostile = "<img src=x onerror=alert(1)> too long";
    const { container } = render(<ConversationSurface items={[]} validationError={hostile} />);
    expect(container.textContent).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps the messages visible while the validation message shows", () => {
    const { container } = render(
      <ConversationSurface
        items={[VISITOR_ITEM]}
        validationError={NEUTRAL_COPY_DEFAULTS.validation.messageTooLong}
      />,
    );
    expect(messageElements(container)).toHaveLength(1);
    expect(container.querySelector(`[${ERROR_ATTRIBUTE}]`)).not.toBeNull();
  });
});

describe("the validation message is not a fourth render neutral state", () => {
  it("anchors on a real neutral state, which does carry the marker", () => {
    const { container } = render(<PreparingState copy={NEUTRAL_COPY_DEFAULTS} />);
    expect(container.querySelector(`[${NEUTRAL_STATE_ATTRIBUTE}]`)).not.toBeNull();
  });

  it("carries no render-neutral-state marker", () => {
    const { container } = render(
      <ConversationSurface
        items={[]}
        validationError={NEUTRAL_COPY_DEFAULTS.validation.messageTooLong}
      />,
    );
    expect(container.querySelector(`[${NEUTRAL_STATE_ATTRIBUTE}]`)).toBeNull();
    expect(container.querySelector(`[${ERROR_ATTRIBUTE}]`)).not.toBeNull();
  });

  it("shows none of the three render strings", () => {
    const { container } = render(
      <ConversationSurface
        items={[]}
        validationError={NEUTRAL_COPY_DEFAULTS.validation.messageTooLong}
      />,
    );
    const shown = container.querySelector(`[${ERROR_ATTRIBUTE}]`)?.textContent ?? "";
    expect(shown.length).toBeGreaterThan(0);
    expect(Object.values(NEUTRAL_COPY_DEFAULTS.render)).not.toContain(shown);
  });

  it("announces assertively, which no render neutral state does", () => {
    const { container } = render(
      <ConversationSurface
        items={[]}
        validationError={NEUTRAL_COPY_DEFAULTS.validation.messageTooLong}
      />,
    );
    expect(container.querySelector(`[${ERROR_ATTRIBUTE}]`)?.getAttribute("role")).toBe("alert");
    const neutral = render(<PreparingState copy={NEUTRAL_COPY_DEFAULTS} />);
    expect(neutral.container.querySelector("[role]")?.getAttribute("role")).toBe("status");
  });
});

describe("the surface is total on wire input", () => {
  it("anchors: the hostile fixtures really are malformed", () => {
    const throwing = {
      messageId: "e-1:assistant",
      role: "assistant",
      get text(): string {
        throw new Error("hostile getter");
      },
    };
    expect(() => throwing.text).toThrow();
    expect(typeof (7 as unknown)).not.toBe("string");
  });

  it("renders a valid message beside every malformed one, without throwing", () => {
    const malformed: readonly unknown[] = [
      null,
      undefined,
      "a bare string",
      7,
      {},
      { messageId: "e-2:assistant", role: "assistant" },
      { messageId: "e-3:assistant", role: "assistant", text: 7 },
      { messageId: 7, role: "assistant", text: "no usable id" },
      {
        messageId: "e-4:assistant",
        role: "assistant",
        get text(): string {
          throw new Error("hostile getter");
        },
      },
    ];
    for (const item of malformed) {
      const items = [ASSISTANT_ITEM, item] as readonly ConversationItem[];
      const { container, unmount } = render(<ConversationSurface items={items} />);
      expect(container.textContent).toContain(ASSISTANT_ITEM.text);
      expect(
        container.querySelector(`[${MESSAGE_ATTRIBUTE}="${ASSISTANT_ITEM.messageId}"]`),
      ).not.toBeNull();
      unmount();
    }
  });

  it("survives an items value that is not an array at all", () => {
    for (const items of [null, undefined, 7, "text", {}]) {
      const { container, unmount } = render(
        <ConversationSurface items={items as unknown as readonly ConversationItem[]} />,
      );
      expect(container.querySelector(`[${SURFACE_ATTRIBUTE}]`)).not.toBeNull();
      unmount();
    }
  });

  it("survives a validationError that is not a usable string", () => {
    for (const error of [null, 7, {}, "", "   "]) {
      const { container, unmount } = render(
        <ConversationSurface items={[]} validationError={error as unknown as string} />,
      );
      expect(container.querySelector(`[${SURFACE_ATTRIBUTE}]`)).not.toBeNull();
      expect(container.querySelector(`[${ERROR_ATTRIBUTE}]`)).toBeNull();
      // "No marker" alone passed against a stub that showed the default copy
      // under a *different* marker, which is the wrong reason. Nothing at all
      // may be shown for an unusable value.
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("renders byte-identical markup across repeated renders of the same input", () => {
    const first = render(
      <ConversationSurface
        items={[VISITOR_ITEM, ASSISTANT_ITEM]}
        validationError={NEUTRAL_COPY_DEFAULTS.validation.messageTooLong}
      />,
    );
    const firstHtml = first.container.innerHTML;
    first.unmount();
    const second = render(
      <ConversationSurface
        items={[VISITOR_ITEM, ASSISTANT_ITEM]}
        validationError={NEUTRAL_COPY_DEFAULTS.validation.messageTooLong}
      />,
    );
    expect(second.container.innerHTML).toBe(firstHtml);
    second.unmount();
  });
});

describe("the module surface is closed", () => {
  it("exports exactly the conversation surface at runtime", () => {
    expect(Object.keys(conversationSurface)).toEqual(["ConversationSurface"]);
  });

  /**
   * The module's own source with every comment removed.
   *
   * The stripping matters: this module explains escaping in prose, so a raw-text
   * scan for `dangerouslySetInnerHTML` would match a docblock and pass — or
   * fail — for the wrong reason. The self-check below proves the stripping is
   * real before anything is read into it. The path is built with `fileURLToPath`
   * and `join` because this suite runs under jsdom, where
   * `new URL(file, import.meta.url)` resolves against `http://localhost:3000/`.
   */
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "ConversationSurface.tsx");
  const source = withoutComments(readFileSync(sourcePath, "utf8"));

  it("strips its own comments before scanning, so a scan cannot match its own prose", () => {
    const raw = readFileSync(sourcePath, "utf8");
    expect(raw).toContain("dangerouslySetInnerHTML");
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).toContain("export function ConversationSurface");
  });

  it("has no HTML-injection escape hatch in its code", () => {
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("outerHTML");
    expect(source).not.toContain("insertAdjacentHTML");
    expect(source).not.toContain("createElement");
  });

  it("re-exports nothing", () => {
    expect(source).not.toContain("export *");
  });
});

/** Source text with block and line comments removed, leaving the code alone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

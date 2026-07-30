/**
 * The boundary that makes one registered component's crash cost exactly that
 * component.
 *
 * A registered component is trusted React code the host wrote, and trusted is
 * not the same as infallible. Without a boundary, one component that throws
 * while rendering unmounts the whole page — every sibling, every open `Modal`,
 * every value a visitor had typed. `SubtreeBoundary` wraps each mounted node so
 * the blast radius is that node's subtree, and everything beside it keeps
 * rendering and keeps working.
 *
 * **It keeps nothing about the failure.** No message, no stack, no component
 * name is stored, logged or rendered — the boundary's whole state is a flag and
 * a token. That is not a discipline applied at the rendering seam but the
 * absence of anything to leak, which is why the no-leak assertion in
 * `error-boundary.test.tsx` is written against the entire serialised document
 * rather than the visible text (DC-014).
 *
 * **Identity and reset are two different things, and conflating them is the bug
 * this design exists to avoid.**
 *
 * *Identity* is `${nodeId}:${tag}` — `boundaryIdentity` — which the mounting
 * seam uses as the React key. It is stable for as long as the node is that node,
 * so an accepted mutation that leaves a node in place leaves its boundary, and
 * its subtree's React state, alone.
 *
 * *Reset* is `resetToken`: a value derived at exactly one seam (`mount-node.tsx`,
 * WU-33) from that node's **own** post-binding `{tag, resolvedProps,
 * childNodeIds}`. It is deliberately **not** the authoritative `stageRevision`.
 * A revision-keyed reset would look correct and be quietly destructive: every
 * accepted mutation and every data publish advances the revision for the whole
 * stage, so every boundary on the page would clear at once, remounting subtrees
 * that never failed and taking unrelated `Field` state, focus and open `Modal`
 * state with them. Deriving the token node-locally means a crashed subtree
 * revives exactly when *its own* input actually changed, and no other subtree
 * moves.
 *
 * From that, two behaviours follow, and both are asserted:
 *
 * - A **healthy** boundary ignores `resetToken` entirely. It records the value
 *   so a later crash has a baseline, and does not remount its children.
 * - A **latched** boundary clears only when **its own** token changes. A
 *   neighbour's change is not its change.
 *
 * **Scope: render and lifecycle.** React boundaries see throws raised while
 * rendering, and in the lifecycle methods around it. They do not see a throw
 * from an event handler — React catches that at its dispatch boundary and hands
 * it to the environment, so it never reaches an ancestor's `componentDidCatch`.
 * `safeInvoke` closes that half: every handler Facet injects into a mounted
 * component goes through it, so a throw on the way back out of a component is
 * contained too. The two halves are stated here because the boundary alone
 * reads like a complete answer and is not one.
 *
 * **Visibility.** `SubtreeBoundary` is barrel-exported. `boundaryIdentity` and
 * `safeInvoke` are module exports for their sibling renderer modules only —
 * `@internal`, absent from `index.ts`, and not importable across a package
 * boundary.
 */

import type { NeutralCopy } from "@facet/core";
import type { ReactNode } from "react";
import { Component } from "react";

import { CrashState } from "./fallback.js";

/**
 * The stable identity of one node's boundary: `${nodeId}:${tag}`.
 *
 * The mounting seam passes this as the React key, which is what ties a boundary
 * instance to a node rather than to a position among its siblings. It is derived
 * here, in one place, so the two halves cannot drift apart — a boundary keyed by
 * position would carry another node's latched crash state when a sibling was
 * removed.
 *
 * @internal Not barrel-exported; `@facet/react`-private.
 */
export function boundaryIdentity(nodeId: string, tag: string): string {
  return `${nodeId}:${tag}`;
}

/**
 * Wraps a handler Facet injects into a mounted component so a throw on the way
 * out cannot escape into the page.
 *
 * React's boundaries do not cover event handlers, so a `onAction` or
 * `onValueChange` implementation that threw would surface as an unhandled error
 * with the subtree left in place — the one failure mode the boundary above
 * cannot answer. The error is deliberately swallowed rather than re-raised
 * asynchronously: re-raising would put back exactly the unhandled error this
 * exists to prevent, and there is nothing to show a visitor about a handler that
 * did not complete. The handler's own result is returned when it completes, and
 * `undefined` when it does not, so the wrapper is transparent on the path that
 * works.
 *
 * @internal Not barrel-exported; `@facet/react`-private.
 */
export function safeInvoke<Argument, Result>(
  handler: (argument: Argument) => Result,
): (argument: Argument) => Result | undefined {
  return (argument: Argument): Result | undefined => {
    try {
      return handler(argument);
    } catch {
      return undefined;
    }
  };
}

/**
 * The subtree boundary. One per mounted node.
 *
 * The props and state shapes are written inline rather than as named aliases: a
 * barrel-exported class's emitted declaration may not reference a name a
 * consumer cannot import (D-12), and both shapes are small enough that spelling
 * them out costs less than the indirection would.
 */
export class SubtreeBoundary extends Component<
  {
    /** The session's resolved neutral copy — the only source of what a crash shows. */
    readonly copy: NeutralCopy;
    /**
     * This node's own post-binding input, reduced to a value that changes when
     * the node's resolved input changes and at no other time. Never
     * `stageRevision`.
     */
    readonly resetToken: string;
    /** The mounted subtree this boundary protects. */
    readonly children?: ReactNode;
  },
  {
    /** Whether this boundary has caught a throw and is showing the crash state. */
    readonly crashed: boolean;
    /** The `resetToken` this boundary last rendered with. */
    readonly seenToken: string;
  }
> {
  constructor(props: SubtreeBoundary["props"]) {
    super(props);
    this.state = { crashed: false, seenToken: props.resetToken };
  }

  /**
   * Latches. Nothing about the error is captured — not the error, not its
   * message, not the component that threw — so there is nothing for the crash
   * state to leak and nothing for a later render to accidentally surface.
   */
  static getDerivedStateFromError(): { readonly crashed: true } {
    return { crashed: true };
  }

  /**
   * The whole of the reset rule, and it is deliberately one comparison.
   *
   * An unchanged token means nothing about this node's input moved: a healthy
   * boundary stays healthy and a latched one stays latched, whatever happened
   * elsewhere on the stage. A changed token means this node's own resolved input
   * moved, which is the only event that justifies giving its subtree another go
   * — so the flag clears and the new value becomes the baseline. A healthy
   * boundary passing through here re-renders but does not remount: its children
   * are the same elements at the same key, so their state, focus and any open
   * `Modal` survive.
   */
  static getDerivedStateFromProps(
    props: SubtreeBoundary["props"],
    state: SubtreeBoundary["state"],
  ): SubtreeBoundary["state"] | null {
    if (props.resetToken === state.seenToken) {
      return null;
    }
    return { crashed: false, seenToken: props.resetToken };
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      return <CrashState copy={this.props.copy} />;
    }
    return this.props.children;
  }
}

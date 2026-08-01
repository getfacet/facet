/**
 * The stage — one session, composed.
 *
 * Every renderer module before this one answers a question in isolation:
 * `bootstrap.ts` closes the trust boundary, `mount-node.tsx` turns a stored node
 * into trusted React, `binding.ts` resolves props against the model in force,
 * `nav.ts` holds which screen the visitor is on, `field-store.ts` owns collected
 * values, and `modal-frame.tsx` owns the one sanctioned overlap. This file is
 * where they become a page, and the composition is the contract — not an
 * arrangement a host may vary.
 *
 * **The seam is the framework's.** A registered component reports only that the
 * interaction declared on one of its props was activated: `onAction(prop)`, with
 * no target, no payload and no return value. This module holds the document, so
 * it is this module that resolves the reference. A `nav:` moves the visitor
 * through browser view-state and writes nothing (DC-018). An `agent:` becomes
 * one forwarded event carrying exactly the fields the author named in the
 * framework's reserved `collect` prop, read from the **field store** and never
 * from the page (D-08), plus the one explicit argument the acting node resolved
 * under the framework's other reserved name, `arg` (D-07). Everything else — an
 * unparseable reference, a browser-local action scheme, a prop that carries no action at all
 * — is inert. There is no local action router, and there is nowhere to register
 * one.
 *
 * **Which branch an activation takes is decided from the resolved reference, not
 * from a prop name.** Facet reserves no action-prop name at all: `action` is one
 * catalog's spelling of it, so an authored `arg` beside a `nav:` is accepted at
 * author time and simply never reaches an event — there is no event for it to
 * reach. And an argument that was not authored is **omitted**, not sent as
 * `undefined`, because a present key is the claim that one was sent.
 *
 * **The overlay root is mounted here, exactly once, as a sibling of the document
 * tree.** `OverlayRootProvider` renders the portal target beside its children,
 * and this module is what keeps it out of every containment element: mounting
 * creates containment *inside* the children, so a target rendered beside them
 * cannot have one above it unless this composition wrapped the provider in one
 * (D-13). One provider and one `ModalHost` per `StageRenderer`, so two stages on
 * one page are two sessions with two ordered open lists and two portal targets.
 *
 * **`renderModal` is memo-stable and carries the theme, and both halves matter.**
 * The callback is the only path from a `Modal` node's content to the framework
 * frame, and it is supplied to `MountContext` — never to a public prop, so a host
 * cannot replace the frame with chrome of its own. It closes over the session's
 * projected custom properties and hands them to `ModalFrame`, which is what makes
 * a portalled dialog themed at all: the dialog sits outside the screen subtree
 * entirely, so nothing above it in the DOM carries the properties a registered
 * component would otherwise inherit. `ModalMountRequest` deliberately excludes
 * the theme, because it is the composition's to close over rather than mounting's
 * to thread down. Its identity survives an unrelated stage update, so a document
 * patch or a data publish does not hand every mounted node a new context field.
 *
 * **What "no document" and "no screen" mean, and why they differ.** A `null`
 * document is a session that has not been authored yet, and it shows the
 * preparing neutral state. A document that declares no screen this renderer can
 * derive is the **safe-empty stage** — nothing at all — which is `nav.ts`'s
 * stated outcome for that case and is deliberately not a neutral state: there is
 * no fourth slot in `NeutralCopy` and inventing one would put framework words on
 * a page for a fault the visitor cannot act on.
 *
 * **The browser is not a second writer.** Nothing here mutates the document, the
 * model or a node: navigation is React state, a collected value lives in the
 * session store, and an event is handed to the host. `StageRenderer.test.tsx`
 * observes the document across a whole navigate/open/type/send cycle rather than
 * taking the claim on trust.
 *
 * **Visibility: barrel-exported** — `StageRenderer` and `StageRendererProps`
 * only. No other symbol in this module is public.
 */

import { parseAction, themeToCssVars } from "@facet/core";
import type { VisitorEvent, ComponentDocument, ComponentNode, DataModel } from "@facet/core";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

import type { RendererBootstrap } from "./bootstrap.js";
import { DataProvider, resolveProps } from "./binding.js";
import { buildCollectPayload } from "./collect.js";
import { OverlayRootProvider } from "./containment.js";
import { PreparingState } from "./fallback.js";
import { createFieldStore } from "./field-store.js";
import { ModalFrame, ModalHost } from "./modal-frame.js";
import { MountNode } from "./mount-node.js";
import type { ModalMountRequest, MountContext } from "./mount-node.js";
import { useScreenView } from "./nav.js";
import { isRecord, readOwn } from "./safe-read.js";

/**
 * The framework's reserved request list, read from the activating node's
 * resolved props.
 *
 * `collect` is a **framework** prop name the catalog reserves and author
 * validation enforces, not a convention this module inferred from a component
 * that happens to declare one. That is why reading it here is composition rather
 * than the renderer growing an opinion about somebody's component.
 */
const COLLECT_PROP = "collect";

/**
 * The framework's reserved event argument, read from the same resolved props.
 *
 * `arg` is reserved by the same convention and enforced in the same place as
 * `collect` (D-07): the catalog refuses a spec that declares `arg` as anything
 * other than a scalar string carrying no default and no binding, so a component
 * cannot mean something else by the name. Reading it here is therefore
 * composition, not the renderer inferring a payload from a prop it liked the
 * look of.
 *
 * What is **not** reserved is the prop that carries the action. `action` is one
 * catalog's spelling, and a component may name its interaction anything; that is
 * why the decision below is made from the action reference this module already
 * resolved and is already dispatching on, and never from a prop called `action`.
 */
const ARG_PROP = "arg";

/**
 * The stage a session shows while there is no document.
 *
 * A module constant rather than a fresh object, because `useScreenView` is a
 * hook and must be called on every render: it is handed this stand-in when there
 * is nothing to mount, and a new object each time would make the screen
 * derivation churn for a page that has not been authored yet.
 */
const NO_DOCUMENT: ComponentDocument = Object.freeze({
  entry: "",
  screens: Object.freeze([]),
  nodes: Object.freeze({}),
});

/**
 * What a host mounts one session with.
 *
 * `bootstrap` is the **accepted** branch of `bootstrapRenderer`'s result, so a
 * rejected bootstrap is not something this component can be handed: half a trust
 * boundary is not a trust boundary, and narrowing at the host is what makes that
 * a type error rather than a runtime check. The document and the model are the
 * stage in force — this component reads both and writes neither.
 *
 * There is deliberately **no** prop for the modal frame, the overlay root, the
 * field store or the neutral copy beyond the one the bootstrap already carries.
 * Each of those is a framework guarantee, and a prop for it would be the way out
 * of the guarantee.
 */
export interface StageRendererProps {
  /** The validated session boundary: catalog index, registry, theme and copy. */
  readonly bootstrap: Extract<RendererBootstrap, { readonly ok: true }>;
  /** The document in force, or `null` while the agent has not authored one. */
  readonly document: ComponentDocument | null;
  /** The Data Model in force. A publish is a **new** model object, never a mutation. */
  readonly data: DataModel;
  /**
   * Receives one forwarded `agent:` event.
   *
   * The renderer knows the event's name, the node it came from, the screen it
   * happened on, and the fields the author asked for; it does **not** know the
   * client idempotency token or the authoritative stage revision, which the
   * transport stamps. Omit it for a stage that shows published data and
   * navigates, but sends nothing.
   */
  readonly onEvent?: (event: {
    readonly eventName: string;
    readonly sourceNodeId: string;
    readonly screen: string;
    /**
     * The one explicit argument, present only when the acting node resolved one.
     *
     * Optional **exactly**: `exactOptionalPropertyTypes` makes an explicit
     * `arg: undefined` a type error here, which is the compile-time half of the
     * rule the emission below keeps at runtime. The distinction is not
     * decorative — the transport stamps `eventId` and `stageRevision` onto this
     * object and hands it to `validateVisitorEvent`, which reads a present key as
     * "an argument was sent" and rejects a non-string. An argument that was
     * never authored has to be absent, not empty.
     */
    readonly arg?: string;
    readonly collect: VisitorEvent["collect"];
  }) => void;
}

/**
 * Reads the node an interaction came from, or `null` when nothing usable is
 * stored under that id.
 *
 * Deliberately narrower than mounting's reader: an action only needs a tag to
 * find the spec and a props record to resolve, so the child list is not read
 * here at all. Mounting's own reader stays the authority on what a **mountable**
 * node is; this one answers a different question about a node that is already on
 * the page.
 */
function readActingNode(document: ComponentDocument, nodeId: string): ComponentNode | null {
  const stored = readOwn(readOwn(document, "nodes"), nodeId);
  if (!isRecord(stored)) {
    return null;
  }
  const tag = readOwn(stored, "tag");
  return typeof tag === "string" && tag.length > 0 && isRecord(readOwn(stored, "props"))
    ? (stored as unknown as ComponentNode)
    : null;
}

/**
 * Renders one Facet session.
 *
 * The hook order is fixed and unconditional — the store, the theme projection,
 * the screen view-state, the two callbacks and the context — and only the last
 * expression branches. A conditional hook here would make "the document arrived"
 * a remount of the whole session, taking every open modal and every typed value
 * with it.
 */
export function StageRenderer({
  bootstrap,
  document: stageDocument,
  data,
  onEvent,
}: StageRendererProps): ReactNode {
  // One store per session, created once. Two stages on one page therefore share
  // no collected value, and there is no module-level store for them to share.
  const [store] = useState(createFieldStore);
  const themeVars = useMemo(() => themeToCssVars(bootstrap.theme), [bootstrap.theme]);
  const active = stageDocument ?? NO_DOCUMENT;
  const { current, navigate } = useScreenView(active);
  const screen = current === null ? "" : current.name;

  const onAction = useCallback(
    (nodeId: string, prop: string): void => {
      try {
        const node = readActingNode(active, nodeId);
        if (node === null) {
          return;
        }
        const spec = bootstrap.index.get(node.tag);
        if (spec === undefined) {
          return;
        }
        // Resolved again rather than remembered: the props a component was
        // mounted with are the props of the document and model in force, and
        // re-deriving them from those two is what keeps a captured handler from
        // acting on a superseded reference.
        const resolved = resolveProps(node, spec, data);
        const reference = resolved.props[prop];
        if (typeof reference !== "string") {
          // A prop that carries no action reference is a no-op, never an error:
          // a component may report an interaction without knowing whether the
          // author wired one up.
          return;
        }
        const parsed = parseAction(reference, active);
        if (!parsed.ok) {
          return;
        }
        if (parsed.action.kind === "nav") {
          // `nav.ts` is the sole authority on navigation, so the reference goes
          // back to it rather than this module acting on the parse it just did.
          navigate(reference);
          return;
        }
        if (onEvent === undefined) {
          return;
        }
        // Read only here, past the `nav:` return above: a navigation carries no
        // event, so there is nothing for an argument beside one to ride on, and
        // the author boundary accepts that pairing rather than calling it a
        // fault. The read is own by construction — `resolveProps` returns a
        // null-prototype record — and post-resolution by construction too, which
        // is what keeps an argument the document merely inherited, or one the
        // schema refused, out of the payload.
        const argument = resolved.props[ARG_PROP];
        const payload = buildCollectPayload(resolved.props[COLLECT_PROP], (name) =>
          store.collectSource(name),
        );
        onEvent({
          eventName: parsed.action.event,
          sourceNodeId: nodeId,
          screen,
          // Omitted entirely when there is none. An `arg: undefined` would reach
          // the transport as a key, and a key is the claim that an argument was
          // sent — `""` is a legitimate argument and must stay tellable apart
          // from no argument at all.
          ...(typeof argument === "string" ? { arg: argument } : {}),
          collect: payload.collect,
        });
      } catch {
        // Total on its own. Mounting already wraps this seam in `safeInvoke`, so
        // a throw could not unwind a subtree either way — but a property that
        // depends on a caller's discipline is not a property.
      }
    },
    [active, bootstrap.index, data, navigate, onEvent, screen, store],
  );

  // Memo-stable across everything but the theme itself. A new identity on each
  // stage update would hand every mounted node a changed context field for a
  // callback that does the same thing, and the frame is the one seam where that
  // churn is most expensive.
  const renderModal = useCallback(
    (request: ModalMountRequest): ReactNode => (
      <ModalFrame nodeId={request.nodeId} props={request.props} themeVars={themeVars}>
        {request.content}
      </ModalFrame>
    ),
    [themeVars],
  );

  const context = useMemo<MountContext>(
    () => ({
      document: active,
      index: bootstrap.index,
      registry: bootstrap.registry,
      themeVars,
      copy: bootstrap.copy,
      store,
      onAction,
      renderModal,
    }),
    [
      active,
      bootstrap.index,
      bootstrap.registry,
      bootstrap.copy,
      themeVars,
      store,
      onAction,
      renderModal,
    ],
  );

  return (
    <ModalHost>
      <OverlayRootProvider>
        <DataProvider model={data}>
          {stageDocument === null ? (
            <PreparingState copy={bootstrap.copy} />
          ) : current === null ? null : (
            <MountNode context={context} nodeId={current.nodeId} />
          )}
        </DataProvider>
      </OverlayRootProvider>
    </ModalHost>
  );
}

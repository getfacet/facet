import { DEFAULT_CATALOG, DEFAULT_THEME } from "@facet/assets";
import { DEFAULT_REGISTRY } from "@facet/assets/react";
import { bootstrapRenderer, StageRenderer } from "@facet/react";
import type { RendererBootstrap } from "@facet/react";
import { Component } from "react";
import type { ReactNode } from "react";

import type { ComponentPreviewFixtureResult } from "./component-preview-fixtures.js";

type AcceptedBootstrap = Extract<RendererBootstrap, { readonly ok: true }>;
type PreviewFallbackReason = "invalid-fixture" | "bootstrap" | "render";

interface ComponentPreviewContentProps {
  readonly result: ComponentPreviewFixtureResult;
  readonly rendererBootstrap?: AcceptedBootstrap;
  readonly suppressModals?: boolean;
}

export interface ComponentPreviewProps extends ComponentPreviewContentProps {
  readonly renderContent?: (props: ComponentPreviewContentProps) => ReactNode;
}

const DEFAULT_BOOTSTRAP = bootstrapRenderer({
  catalog: DEFAULT_CATALOG,
  registry: DEFAULT_REGISTRY,
  theme: DEFAULT_THEME,
});

function PreviewFallback({
  tag,
  reason,
}: {
  readonly tag: string;
  readonly reason: PreviewFallbackReason;
}): ReactNode {
  return (
    <div
      role="status"
      aria-live="polite"
      data-facet-component-preview={tag}
      data-facet-component-preview-state="fallback"
      data-facet-component-preview-fallback={reason}
    >
      Preview unavailable
    </div>
  );
}

class PreviewBoundary extends Component<
  {
    readonly resetKey: string;
    readonly tag: string;
    readonly children: ReactNode;
  },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(previous: { readonly resetKey: string }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <PreviewFallback tag={this.props.tag} reason="render" />;
    }
    return this.props.children;
  }
}

export function ComponentPreview({
  result,
  rendererBootstrap,
  suppressModals,
  renderContent,
}: ComponentPreviewProps): ReactNode {
  const resetKey = result.ok
    ? `${result.tag}:${result.fixture.targetNodeId}`
    : `${result.tag}:error`;
  return (
    <PreviewBoundary resetKey={resetKey} tag={result.tag}>
      <PreviewContentSlot
        result={result}
        {...(rendererBootstrap === undefined ? {} : { rendererBootstrap })}
        {...(suppressModals === undefined ? {} : { suppressModals })}
        {...(renderContent === undefined ? {} : { renderContent })}
      />
    </PreviewBoundary>
  );
}

function PreviewContentSlot({
  renderContent = ComponentPreviewContent,
  ...props
}: ComponentPreviewProps): ReactNode {
  return renderContent(props);
}

function ComponentPreviewContent({
  result,
  rendererBootstrap,
  suppressModals,
}: ComponentPreviewContentProps): ReactNode {
  if (!result.ok) {
    return <PreviewFallback tag={result.tag} reason="invalid-fixture" />;
  }

  const bootstrap = rendererBootstrap ?? DEFAULT_BOOTSTRAP;
  if (!bootstrap.ok) {
    return <PreviewFallback tag={result.tag} reason="bootstrap" />;
  }

  return (
    <div data-facet-component-preview={result.tag} data-facet-component-preview-state="ready">
      <StageRenderer
        bootstrap={bootstrap}
        document={result.fixture.document}
        data={result.fixture.data}
        {...(suppressModals === undefined ? {} : { suppressModals })}
      />
    </div>
  );
}

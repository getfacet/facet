// @vitest-environment jsdom
import type { ComponentSpec, MountedComponent } from "@facet/core";
import { themeToCssVars } from "@facet/core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CATALOG } from "../catalog.js";
import {
  ALERT_SPEC,
  AVATAR_SPEC,
  CTA_SPEC,
  DIVIDER_SPEC,
  FEATURE_LIST_SPEC,
  FOOTER_SPEC,
  GALLERY_SPEC,
  HERO_SPEC,
  LINK_LIST_SPEC,
  LOGO_MARK_SPEC,
  MEDIA_CARD_SPEC,
  NAV_SPEC,
  PRODUCT_SHOWCASE_SPEC,
  PROFILE_HEADER_SPEC,
  PROGRESS_SPEC,
  SECTION_SPEC,
  SIDE_NAV_SPEC,
  SIDE_NAV_ITEM_SPEC,
  SOCIAL_LINKS_SPEC,
  STAT_STRIP_SPEC,
  TESTIMONIAL_SPEC,
  TIMELINE_SPEC,
  VISUAL_PANEL_SPEC,
} from "../specs-expression.js";
import { DEFAULT_THEME } from "../theme-default.js";
import {
  Alert,
  Avatar,
  CTA,
  Divider,
  FeatureList,
  Footer,
  Gallery,
  Hero,
  LinkList,
  LogoMark,
  MediaCard,
  Nav,
  ProductShowcase,
  ProfileHeader,
  Progress,
  Section,
  SideNav,
  SideNavItem,
  SocialLinks,
  StatStrip,
  Testimonial,
  Timeline,
  VisualPanel,
} from "./expression.js";

type MountProps = Readonly<Record<string, string | number | boolean>>;

interface Registered {
  readonly spec: ComponentSpec;
  readonly implementation: MountedComponent<ReactNode, ReactNode>;
  readonly required: MountProps;
  readonly children?: ReactNode;
}

const THEME_VARS = themeToCssVars(DEFAULT_THEME, { catalog: DEFAULT_CATALOG });
const REGISTERED: readonly Registered[] = [
  { spec: LOGO_MARK_SPEC, implementation: LogoMark, required: { label: "Facet" } },
  { spec: NAV_SPEC, implementation: Nav, required: { brand: "Facet" }, children: "Actions" },
  {
    spec: SIDE_NAV_SPEC,
    implementation: SideNav,
    required: { title: "Facet" },
    children: "Actions",
  },
  {
    spec: SIDE_NAV_ITEM_SPEC,
    implementation: SideNavItem,
    required: { label: "Overview", action: "agent:overview" },
  },
  { spec: SECTION_SPEC, implementation: Section, required: { title: "Profile" }, children: "Body" },
  { spec: DIVIDER_SPEC, implementation: Divider, required: { label: "Details" } },
  { spec: HERO_SPEC, implementation: Hero, required: { title: "Alex Morgan" }, children: "Action" },
  { spec: AVATAR_SPEC, implementation: Avatar, required: { label: "Alex Morgan" } },
  {
    spec: PROFILE_HEADER_SPEC,
    implementation: ProfileHeader,
    required: { name: "Alex Morgan" },
    children: "Links",
  },
  {
    spec: PRODUCT_SHOWCASE_SPEC,
    implementation: ProductShowcase,
    required: { title: "Northstar Audio" },
    children: "Action",
  },
  {
    spec: VISUAL_PANEL_SPEC,
    implementation: VisualPanel,
    required: { title: "Campaign tile" },
    children: "Detail",
  },
  {
    spec: MEDIA_CARD_SPEC,
    implementation: MediaCard,
    required: { title: "Citrus launch" },
    children: "Detail",
  },
  { spec: LINK_LIST_SPEC, implementation: LinkList, required: {}, children: "Links" },
  { spec: SOCIAL_LINKS_SPEC, implementation: SocialLinks, required: {}, children: "Links" },
  { spec: FEATURE_LIST_SPEC, implementation: FeatureList, required: {}, children: "Feature" },
  { spec: STAT_STRIP_SPEC, implementation: StatStrip, required: {}, children: "Stats" },
  { spec: GALLERY_SPEC, implementation: Gallery, required: {}, children: "Gallery item" },
  {
    spec: TESTIMONIAL_SPEC,
    implementation: Testimonial,
    required: { quote: "Clear and direct.", source: "Mina" },
  },
  { spec: TIMELINE_SPEC, implementation: Timeline, required: {}, children: "Milestone" },
  { spec: CTA_SPEC, implementation: CTA, required: { title: "Start now" }, children: "Button" },
  { spec: ALERT_SPEC, implementation: Alert, required: { title: "Heads up" }, children: "Fix" },
  { spec: PROGRESS_SPEC, implementation: Progress, required: { label: "Profile", value: 42 } },
  { spec: FOOTER_SPEC, implementation: Footer, required: {}, children: "Footer action" },
];

const OUT_OF_FLOW_PROPERTIES: readonly string[] = [
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "float",
];

afterEach(cleanup);

function noop(): void {
  return undefined;
}

function renderComponent(
  registered: Registered,
  props: MountProps = registered.required,
): HTMLElement {
  const Component = registered.implementation;
  const { container } = render(
    <Component props={props} themeVars={THEME_VARS} onAction={noop}>
      {registered.children ?? null}
    </Component>,
  );
  expect(container.childElementCount).toBe(1);
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new Error("Expected one HTMLElement root.");
  }
  return root;
}

function authoredDeclarations(root: HTMLElement): readonly (readonly [string, string])[] {
  const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
  return nodes.flatMap((node) => {
    if (!(node instanceof HTMLElement)) return [];
    return Array.from(node.style)
      .map((name) => [name, node.style.getPropertyValue(name)] as const)
      .filter(([, value]) => value !== "");
  });
}

describe("expression React implementations", () => {
  it("renders expressive components flow-contained", () => {
    for (const registered of REGISTERED) {
      const root = renderComponent(registered);

      expect(root.getAttribute("data-facet-component")).toBe(registered.spec.tag);
      expect(root.textContent?.length ?? 0, registered.spec.tag).toBeGreaterThan(0);
      cleanup();
    }
  }, 60_000);

  it("emits no positioning, stacking, float, scripts, anchors or images", () => {
    for (const registered of REGISTERED) {
      const root = renderComponent(registered);

      expect(root.querySelector("script,style,a,img"), registered.spec.tag).toBeNull();
      expect(
        authoredDeclarations(root).filter(([name]) => OUT_OF_FLOW_PROPERTIES.includes(name)),
        registered.spec.tag,
      ).toEqual([]);
      cleanup();
    }
  }, 60_000);

  it("styles every root from the active theme custom properties", () => {
    for (const registered of REGISTERED) {
      const root = renderComponent(registered);

      expect(
        Object.keys(THEME_VARS).every((name) => root.style.getPropertyValue(name) !== ""),
      ).toBe(true);
      cleanup();
    }
  }, 60_000);

  it("keeps media and progress behavior bounded", () => {
    const avatar = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "Avatar")!,
      { label: "Alex Morgan" },
    );
    expect(avatar.textContent).toContain("AM");
    expect(avatar.querySelector("img")).toBeNull();
    cleanup();

    const progress = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "Progress")!,
      { label: "Profile", value: 142 },
    );
    expect(progress.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "100",
    );
    const value =
      progress.querySelector('[role="progressbar"]')?.previousElementSibling?.lastElementChild;
    expect(value).toBeInstanceOf(HTMLElement);
    expect((value as HTMLElement).style.whiteSpace).toBe("nowrap");
    expect((value as HTMLElement).style.flexShrink).toBe("0");
  });

  it("lets visual panels stretch to the row height their parent establishes", () => {
    const panel = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "VisualPanel")!,
      { title: "Campaign tile", caption: "Launch proof" },
    );

    expect(panel.style.height).toBe("100%");
  });

  it("keeps long hero titles contained on narrow screens", () => {
    const hero = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "Hero")!,
      { title: "Averylongservicenamewithoutanaturalbreakpoint" },
    );
    const title = hero.querySelector("h1");

    expect(title).toBeInstanceOf(HTMLElement);
    expect((hero as HTMLElement).style.containerType).toBe("inline-size");
    expect((title as HTMLElement).style.minWidth).toBe("0px");
    expect((title as HTMLElement).style.maxWidth).toBe("100%");
    expect((title as HTMLElement).style.overflowWrap).toBe("anywhere");
    expect((title as HTMLElement).style.fontSize).toContain("clamp(");
    expect((title as HTMLElement).style.fontSize).toContain("8cqi");
  });

  it("lets side navigation fill the stretched rail its parent establishes", () => {
    const sideNav = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "SideNav")!,
      {
        title: "Revenue",
        label: "Command center",
      },
    );

    expect(sideNav.style.height).toBe("100%");
    expect(sideNav.style.alignSelf).toBe("stretch");
  });

  it("keeps media cards stable inside equal-height galleries", () => {
    const mediaCard = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "MediaCard")!,
      {
        title: "Citrus launch",
        description: "Offer proof and launch story.",
        aspect: "square",
      },
    );
    const visual = mediaCard.firstElementChild;
    const body = visual?.nextElementSibling;

    expect(mediaCard.style.height).toBe("100%");
    expect(visual).toBeInstanceOf(HTMLElement);
    expect((visual as HTMLElement).style.boxSizing).toBe("border-box");
    expect((visual as HTMLElement).style.width).toBe("100%");
    expect((visual as HTMLElement).style.flexShrink).toBe("0");
    expect(body).toBeInstanceOf(HTMLElement);
    expect((body as HTMLElement).style.flex).toBe("1 1 0%");
  });

  it("keeps media-card visual labels contained on narrow screens", () => {
    const mediaCard = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "MediaCard")!,
      {
        title: "LiveFrame",
        eyebrow: "averylonglabelwithoutbreakpoints",
        meta: "liveframe.dev",
      },
    );
    const labels = mediaCard.firstElementChild?.querySelectorAll("span");

    expect(labels).toHaveLength(2);
    for (const label of labels ?? []) {
      expect((label as HTMLElement).style.minWidth).toBe("0px");
      expect((label as HTMLElement).style.maxWidth).toContain("100%");
      expect((label as HTMLElement).style.overflowWrap).toBe("anywhere");
    }
  });

  it("keeps product showcases contained on narrow screens", () => {
    const showcase = renderComponent(
      REGISTERED.find((registered) => registered.spec.tag === "ProductShowcase")!,
      {
        title: "Averylongservicenamewithoutanaturalbreakpoint",
        description: "Averylongdescriptionwithoutanaturalbreakpoint",
        eyebrow: "Averylongeyebrowwithoutanaturalbreakpoint",
        meta: "averylonglabelwithoutbreakpoints",
      },
    );
    const [content, visual] = Array.from(showcase.children);
    const title = content?.querySelector("h1");
    const paragraphs = content?.querySelectorAll("p");
    const labels = visual?.querySelectorAll("span");

    expect(showcase.style.gridTemplateColumns).toContain("min(16rem, 100%)");
    expect(showcase.style.maxWidth).toBe("100%");
    expect(content).toBeInstanceOf(HTMLElement);
    expect((content as HTMLElement).style.boxSizing).toBe("border-box");
    expect((content as HTMLElement).style.maxWidth).toBe("100%");
    expect(title).toBeInstanceOf(HTMLElement);
    expect((title as HTMLElement).style.overflowWrap).toBe("anywhere");
    expect(paragraphs).toHaveLength(2);
    for (const paragraph of paragraphs ?? []) {
      expect((paragraph as HTMLElement).style.maxWidth).toBe("100%");
      expect((paragraph as HTMLElement).style.overflowWrap).toBe("anywhere");
    }
    expect(visual).toBeInstanceOf(HTMLElement);
    expect((visual as HTMLElement).style.boxSizing).toBe("border-box");
    expect((visual as HTMLElement).style.width).toBe("100%");
    expect((visual as HTMLElement).style.maxWidth).toBe("100%");
    expect(labels).toHaveLength(2);
    for (const label of labels ?? []) {
      expect((label as HTMLElement).style.maxWidth).toContain("100%");
      expect((label as HTMLElement).style.overflowWrap).toBe("anywhere");
    }
  });
});

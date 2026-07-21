import type { BrickType, FacetTree } from "@facet/core";

import { REFERENCE_BENCHMARK_FIXTURES } from "./fixtures-reference-benchmarks.js";
import type { ExpectedPreset, ScenarioExpectedAssets } from "./scenarios.js";

export const REFERENCE_BENCHMARK_GAP_CATEGORIES = [
  "authoring",
  "asset-guidance",
  "brick-vocabulary",
  "renderer-quality",
] as const;
export type ReferenceBenchmarkGapCategory = (typeof REFERENCE_BENCHMARK_GAP_CATEGORIES)[number];

export const REFERENCE_BENCHMARK_AUTHORING_PROTOCOL = [
  "Capture the official public reference at a fixed desktop viewport before authoring.",
  "Decompose the reference into page shell, layout regions, component inventory, density, hierarchy, and chart/table requirements.",
  "Write a human-authored Facet document first; do not treat provider output as the ceiling.",
  "Render the Facet document in Lab and compare screenshots side-by-side with the reference.",
  "Classify remaining gaps as authoring, asset guidance, or Brick/renderer vocabulary before changing Core.",
] as const;

export const REFERENCE_BENCHMARK_IDS = [
  "supabase-table-editor",
  "ama2-public-landing",
  "ama2-messages-app",
  "ops-issue-console",
  "admin-billing-settings",
  "coupang-product-listing",
  "commerce-product-checkout",
  "linktree-selena-gomez",
  "link-in-bio-creator",
  "google-search-console-performance",
  "executive-report-brief",
] as const;
export type ReferenceBenchmarkId = (typeof REFERENCE_BENCHMARK_IDS)[number];

export interface ReferenceBenchmarkSource {
  readonly label: string;
  readonly url: string;
  readonly useFor: string;
}

export interface ReferenceBenchmarkGap {
  readonly category: ReferenceBenchmarkGapCategory;
  readonly summary: string;
  readonly severity: "watch" | "blocking";
}

export interface ReferenceBenchmark {
  readonly id: ReferenceBenchmarkId;
  readonly name: string;
  readonly serviceType: string;
  readonly goal: string;
  readonly fixture: FacetTree;
  readonly expectedAssets: ScenarioExpectedAssets;
  readonly referenceSources: readonly [ReferenceBenchmarkSource, ...ReferenceBenchmarkSource[]];
  readonly targetNotes: readonly [string, ...string[]];
  readonly qaChecklist: readonly [string, ...string[]];
  readonly gaps: readonly [ReferenceBenchmarkGap, ...ReferenceBenchmarkGap[]];
}

function presets(...values: readonly ExpectedPreset[]): readonly ExpectedPreset[] {
  return values;
}

export const REFERENCE_BENCHMARKS: readonly ReferenceBenchmark[] = [
  {
    id: "supabase-table-editor",
    name: "Supabase table editor",
    serviceType: "Database table editor",
    goal: "Recreate a Supabase-style table editor shell with organization/project chrome, left icon rail, table list sidebar, table tab, filter/action toolbar, empty data grid, pagination, and row-edit promotion card.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["supabase-table-editor"],
    expectedAssets: {
      bricks: ["box", "text", "richtext", "table"],
      presets: presets(
        { brick: "box", name: "panel" },
        { brick: "box", name: "badge" },
        { brick: "box", name: "successBadge" },
        { brick: "box", name: "warningBadge" },
        { brick: "box", name: "secondaryAction" },
        { brick: "box", name: "appShell" },
        { brick: "box", name: "topbar" },
        { brick: "box", name: "sidebar" },
        { brick: "box", name: "toolbar" },
        { brick: "box", name: "controlPill" },
        { brick: "text", name: "subheading" },
        { brick: "text", name: "muted" },
        { brick: "text", name: "badge" },
        { brick: "text", name: "actionLabel" },
        { brick: "text", name: "successBadge" },
        { brick: "text", name: "warningBadge" },
        { brick: "text", name: "consoleLabel" },
        { brick: "text", name: "consoleStrong" },
        { brick: "richtext", name: "compact" },
        { brick: "table", name: "dataGrid" },
      ),
      patterns: ["supabase-shell", "supabase-toolbar"],
    },
    referenceSources: [
      {
        label: "Supabase dashboard table editor",
        url: "https://supabase.com/dashboard",
        useFor:
          "User-provided screenshot reference for shell, sidebar, toolbar, grid, empty state, and promo-card layout.",
      },
    ],
    targetNotes: [
      "Human-authored ceiling benchmark: this should represent the best current Facet document I can write by hand.",
      "Match the provided Supabase table editor screenshot rather than a generic analytics dashboard.",
      "Treat browser chrome as out of scope; reproduce the app surface from the Supabase top project bar down.",
      "Preserve the sparse main canvas, dense table header, and thin administrative control rhythm.",
    ],
    qaChecklist: [
      "The first viewport reads as a full app shell, not a centered card.",
      "Left icon rail, table-list sidebar, topbar, editor tab, toolbar, and grid header stay visually distinct.",
      "The empty-table message sits in the large blank grid region without feeling like a form page.",
      "Pagination and the row-edit promotion card reveal whether Facet can approximate anchored product chrome.",
    ],
    gaps: [
      {
        category: "brick-vocabulary",
        severity: "blocking",
        summary:
          "Facet has no app-shell, fixed sidebar, split-pane, column-resize, or anchored floating-card primitive; this benchmark must approximate them with flow Boxes.",
      },
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "Generic media icons now cover simple controls, but brand-specific product icons and table-editor affordances still need custom service assets.",
      },
      {
        category: "renderer-quality",
        severity: "watch",
        summary:
          "The Table renderer cannot express sticky headers, column widths, column separators, resize handles, or empty-grid fill behavior.",
      },
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "Package-default presets stay neutral; this Supabase-specific surface still depends on benchmark custom presets and some direct overrides for dense console chrome.",
      },
    ],
  },
  {
    id: "ama2-public-landing",
    name: "AMA2 public landing",
    serviceType: "AI-agent messenger landing page",
    goal: "Recreate the public AMA2 landing page with slim top navigation, large centered first-fold hero, paired CTA pills, agent-feature explainer, setup steps, beta CTA, and footer.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["ama2-public-landing"],
    expectedAssets: {
      bricks: ["box", "text", "media"],
      presets: presets(
        { brick: "box", name: "inset" },
        { brick: "box", name: "badge" },
        { brick: "box", name: "successBadge" },
        { brick: "box", name: "landingShell" },
        { brick: "box", name: "navBar" },
        { brick: "box", name: "heroBand" },
        { brick: "box", name: "sectionBand" },
        { brick: "box", name: "heroActions" },
        { brick: "box", name: "ctaPrimary" },
        { brick: "box", name: "ctaSecondary" },
        { brick: "box", name: "featureCard" },
        { brick: "box", name: "showcasePanel" },
        { brick: "text", name: "subheading" },
        { brick: "text", name: "body" },
        { brick: "text", name: "muted" },
        { brick: "text", name: "badge" },
        { brick: "text", name: "successBadge" },
        { brick: "text", name: "actionLabel" },
        { brick: "text", name: "navLink" },
        { brick: "text", name: "heroBrand" },
        { brick: "text", name: "heroTitle" },
        { brick: "text", name: "heroBody" },
        { brick: "text", name: "sectionTitle" },
        { brick: "media", name: "productMock" },
      ),
      patterns: ["ama2-hero", "ama2-feature-card"],
    },
    referenceSources: [
      {
        label: "AMA2 public homepage",
        url: "https://ama2.me",
        useFor:
          "Official public first-fold hero, navigation, CTA rhythm, feature explainer, setup cards, beta CTA, and footer.",
      },
    ],
    targetNotes: [
      "Human-authored ceiling benchmark based on a live capture of the public homepage at 1600px desktop width.",
      "The live public page differed from the local AMA2 LivingTranscriptLanding source, so the deployed public surface is the reference.",
      "The first fold should feel intentionally sparse: thin top nav, large centered headline, soft background, and two centered CTA pills.",
      "Below-fold sections should approximate the agent-feature mock, setup timeline, and final beta CTA without adding non-Facet markup.",
    ],
    qaChecklist: [
      "The first viewport should not collapse into a generic card page; it needs the same spacious landing-page rhythm as the reference.",
      "AMA2 in the headline must be visually separated from the rest of the title despite the lack of inline rich text spans in Text.",
      "CTA pills should feel compact, rounded, and centered rather than full-width or heavy.",
      "The feature mock should read as a product demo with chat and participants, not as ordinary body copy.",
    ],
    gaps: [
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "The reference depends on AMA2-specific lavender/peach/mint brand tokens; the fixture uses a media backdrop for the aurora, but exact brand theming still belongs in per-agent assets.",
      },
      {
        category: "brick-vocabulary",
        severity: "watch",
        summary:
          "Facet has no inline styled text spans, so the split-color headline must be composed from multiple Text nodes and can wrap differently from the reference.",
      },
      {
        category: "renderer-quality",
        severity: "watch",
        summary:
          "The landing uses very precise first-fold vertical centering and glow placement; current flow-only spacing and named min-height tokens make this approximate.",
      },
      {
        category: "authoring",
        severity: "watch",
        summary:
          "This level of sparse SaaS landing composition depends on a deliberate custom Pattern and manual screenshot QA, not the package-default marketing samples.",
      },
    ],
  },
  {
    id: "ama2-messages-app",
    name: "AMA2 messages app",
    serviceType: "Agent messenger app",
    goal: "Recreate the actual AMA2 messages screen with a persistent lavender sidebar, selected navigation item, setup CTA, user card, horizontal participant filters, and large rounded message-thread rows.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["ama2-messages-app"],
    expectedAssets: {
      bricks: ["box", "text", "media"],
      presets: presets(
        { brick: "box", name: "messageShell" },
        { brick: "box", name: "sideNav" },
        { brick: "box", name: "threadFilter" },
        { brick: "box", name: "avatarChip" },
        { brick: "box", name: "threadRow" },
        { brick: "box", name: "primaryAction" },
        { brick: "text", name: "navItem" },
        { brick: "text", name: "threadTitle" },
        { brick: "text", name: "threadSnippet" },
        { brick: "text", name: "badge" },
        { brick: "text", name: "actionLabel" },
        { brick: "media", name: "navIconActive" },
        { brick: "media", name: "actionIcon" },
      ),
      patterns: ["ama2-message-shell", "ama2-thread-row"],
    },
    referenceSources: [
      {
        label: "AMA2 messages app",
        url: "https://ama2.me/messages",
        useFor:
          "User-provided screenshot reference for two-pane app shell, participant filters, thread cards, sidebar CTA, and rounded lavender styling.",
      },
    ],
    targetNotes: [
      "Browser chrome is out of scope; reproduce the product surface from the left sidebar and Messages content region.",
      "This target is intentionally different from the public AMA2 landing page: it tests product-app density and repeated inbox rows.",
      "Avatar chips, icons, unread dots, and row truncation are part of the fidelity target.",
    ],
    qaChecklist: [
      "The screen reads as a full app, not a centered content card.",
      "The sidebar, selected nav item, setup CTA, and user card keep the same visual hierarchy.",
      "Horizontal participant filters stay pill-shaped and scan as independent agents.",
      "Thread rows preserve title/snippet/date hierarchy without awkward wrapping.",
    ],
    gaps: [
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "Generic media icons cover navigation affordances, but exact AMA2 logo/avatar art still needs service-specific media assets.",
      },
      {
        category: "renderer-quality",
        severity: "watch",
        summary:
          "Facet Text has no single-line truncation/ellipsis control; long message snippets wrap or rely on authored shortened copy.",
      },
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "The result depends on AMA2-specific app-shell presets rather than package-default patterns.",
      },
    ],
  },
  {
    id: "ops-issue-console",
    name: "Ops issue console",
    serviceType: "Issue triage",
    goal: "Recreate an issue-inbox console with queue filter, prioritized list, detail summary, and triage progress.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["ops-issue-console"],
    expectedAssets: {
      bricks: ["box", "text", "input", "list", "keyValue", "progress"],
      presets: presets(
        { brick: "box", name: "panel" },
        { brick: "box", name: "secondaryAction" },
        { brick: "text", name: "heading" },
        { brick: "text", name: "muted" },
        { brick: "input", name: "compact" },
        { brick: "list", name: "standard" },
        { brick: "keyValue", name: "standard" },
        { brick: "progress", name: "standard" },
      ),
      patterns: ["support-triage", "fixed-filter"],
    },
    referenceSources: [
      {
        label: "Official issue-management product surface",
        url: "https://linear.app/",
        useFor: "Inbox/list/detail navigation density and triage rhythm.",
      },
    ],
    targetNotes: [
      "Issue rows need strong title/body separation and consistent left alignment.",
      "The selected issue detail should feel attached to the list without requiring arbitrary split panes.",
    ],
    qaChecklist: [
      "Filter, list, and detail panel read as one workflow.",
      "List indentation and wrapped bodies are polished.",
      "Action button does not dominate the issue list.",
    ],
    gaps: [
      {
        category: "brick-vocabulary",
        severity: "watch",
        summary:
          "No dedicated split-view/list-detail selection primitive; box/list/keyValue must carry it.",
      },
      {
        category: "asset-guidance",
        severity: "watch",
        summary: "Default list and badge density must support issue-console scanning.",
      },
    ],
  },
  {
    id: "admin-billing-settings",
    name: "Admin billing settings",
    serviceType: "Admin and billing",
    goal: "Recreate a billing/settings surface with account summary, editable fields, status note, and invoice table.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["admin-billing-settings"],
    expectedAssets: {
      bricks: ["box", "text", "input", "keyValue", "table"],
      presets: presets(
        { brick: "box", name: "panel" },
        { brick: "box", name: "inset" },
        { brick: "box", name: "primaryAction" },
        { brick: "text", name: "heading" },
        { brick: "text", name: "warningAlert" },
        { brick: "input", name: "standard" },
        { brick: "keyValue", name: "standard" },
        { brick: "table", name: "standard" },
      ),
      patterns: ["settings-panel", "form"],
    },
    referenceSources: [
      {
        label: "Official dashboard basics guide",
        url: "https://docs.stripe.com/dashboard/basics",
        useFor: "Settings/dashboard information hierarchy and administrative controls.",
      },
    ],
    targetNotes: [
      "Form controls must feel deliberate rather than generic browser defaults.",
      "Invoice table must preserve header/body contrast and scanability.",
    ],
    qaChecklist: [
      "Primary save action aligns with form flow.",
      "Warning text reads as a contained notice, not body copy.",
      "Table columns fit without horizontal escape.",
    ],
    gaps: [
      {
        category: "asset-guidance",
        severity: "watch",
        summary: "Input and table presets carry most of the perceived admin-console quality.",
      },
    ],
  },
  {
    id: "coupang-product-listing",
    name: "Coupang product listing",
    serviceType: "Marketplace product listing",
    goal: "Recreate a Coupang-style product-listing page with promotional strip, category block, brand/search header, shortcut rail, filter sidebar, sort tabs, four-column product grid, product media, price, delivery badges, reviews, and rewards.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["coupang-product-listing"],
    expectedAssets: {
      bricks: ["box", "text", "media", "input", "list"],
      presets: presets(
        { brick: "box", name: "ecommerceShell" },
        { brick: "box", name: "searchBar" },
        { brick: "box", name: "productCard" },
        { brick: "text", name: "body" },
        { brick: "text", name: "price" },
        { brick: "text", name: "muted" },
        { brick: "media", name: "navIcon" },
        { brick: "media", name: "navIconActive" },
        { brick: "media", name: "actionIcon" },
        { brick: "media", name: "productImage" },
        { brick: "list", name: "compact" },
        { brick: "list", name: "standard" },
      ),
      patterns: ["marketplace-listing-shell", "marketplace-product-card"],
    },
    referenceSources: [
      {
        label: "Coupang product listing",
        url: "https://www.coupang.com/",
        useFor:
          "User-provided screenshot reference for Korean marketplace header, category rail, filters, product grid, price and delivery hierarchy.",
      },
    ],
    targetNotes: [
      "Browser chrome and extension popovers are out of scope; reproduce the commerce page surface.",
      "This target tests listing density, product-card scanability, image aspect ratio, price hierarchy, and Korean text wrapping.",
      "Product media is represented by safe placeholder SVGs; the benchmark judges layout and rhythm rather than copying product photos.",
    ],
    qaChecklist: [
      "Search/header/category chrome should feel like a commerce marketplace, not a generic card page.",
      "The left filter rail and product grid must align on a clear column system.",
      "Product titles, discount, price, delivery, rating, and rewards need distinct hierarchy.",
      "Image placeholders must keep the grid stable without awkward crop or unequal tile height.",
    ],
    gaps: [
      {
        category: "brick-vocabulary",
        severity: "watch",
        summary:
          "Facet has no product-card, rating, price, badge-row, or true carousel primitive; these are approximated with Boxes and Text.",
      },
      {
        category: "renderer-quality",
        severity: "watch",
        summary:
          "Media cards need stronger equal-height and object-fit behavior for marketplace grids to feel product-grade.",
      },
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "Dense commerce spacing and price/delivery presets are service-specific assets, not package defaults.",
      },
    ],
  },
  {
    id: "commerce-product-checkout",
    name: "Commerce product and checkout",
    serviceType: "Commerce",
    goal: "Recreate a product detail and one-page checkout flow with media, variants, trust cues, shipping/payment fields, and checkout CTA.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["commerce-product-checkout"],
    expectedAssets: {
      bricks: ["box", "text", "media", "richtext", "input", "list"],
      presets: presets(
        { brick: "box", name: "panel" },
        { brick: "box", name: "inset" },
        { brick: "box", name: "primaryAction" },
        { brick: "text", name: "heading" },
        { brick: "text", name: "metric" },
        { brick: "media", name: "hero" },
        { brick: "richtext", name: "compact" },
        { brick: "input", name: "standard" },
        { brick: "list", name: "compact" },
      ),
      patterns: ["card", "cta-button", "form"],
    },
    referenceSources: [
      {
        label: "Official product-page guidance",
        url: "https://www.shopify.com/blog/product-page",
        useFor: "Product media, price, variants, social proof, and add-to-cart structure.",
      },
      {
        label: "Official one-page checkout guidance",
        url: "https://www.shopify.com/enterprise/blog/one-page-checkout",
        useFor: "Shipping, payment, review, and completion flow in one view.",
      },
    ],
    targetNotes: [
      "Product media, price, options, and checkout form must feel like one purchasing path.",
      "Mobile layout is as important as desktop layout.",
    ],
    qaChecklist: [
      "Media does not crop awkwardly.",
      "Variant controls remain easy to parse.",
      "Checkout CTA is clear but not full-screen unless intentionally full width.",
    ],
    gaps: [
      {
        category: "brick-vocabulary",
        severity: "watch",
        summary:
          "Commerce pages expose limits around grouped options, cart summaries, and price treatment.",
      },
      {
        category: "renderer-quality",
        severity: "watch",
        summary: "Media and input polish determine whether the screen feels shippable.",
      },
    ],
  },
  {
    id: "linktree-selena-gomez",
    name: "Linktree Selena Gomez",
    serviceType: "Celebrity link-in-bio and shop page",
    goal: "Recreate the Selena Gomez Linktree page at mobile width with centered profile header, verified avatar, bio, stacked white link cards, section headers, horizontal shop carousels, repeated media/action links, and narrow gray page shell.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["linktree-selena-gomez"],
    expectedAssets: {
      bricks: ["box", "text", "media"],
      presets: presets(
        { brick: "box", name: "creatorPage" },
        { brick: "box", name: "linkButton" },
        { brick: "box", name: "productTile" },
        { brick: "text", name: "creatorHandle" },
        { brick: "text", name: "body" },
        { brick: "text", name: "subheading" },
        { brick: "text", name: "actionLabel" },
        { brick: "media", name: "actionIcon" },
        { brick: "media", name: "avatar" },
        { brick: "media", name: "productImage" },
      ),
      patterns: ["creator-profile-page", "creator-link-button"],
    },
    referenceSources: [
      {
        label: "Selena Gomez Linktree",
        url: "https://linktr.ee/selenagomez",
        useFor:
          "Official public link-in-bio reference for profile header, sectioned link stack, shop carousel, media links, and mobile-first rhythm.",
      },
    ],
    targetNotes: [
      "This target is judged primarily at mobile width; desktop centering is secondary.",
      "The reference contains live commercial imagery; the benchmark uses safe placeholder SVGs and evaluates layout fidelity.",
      "The page needs to feel like a long, dense creator link stack rather than a generic marketing page.",
    ],
    qaChecklist: [
      "Profile header, avatar, handle, and bio are centered with compact spacing.",
      "White link buttons keep consistent full-width rhythm and comfortable padding.",
      "Product tiles expose whether Facet can approximate horizontal carousels in a narrow viewport.",
      "Long repeated sections should not collapse into visual noise or oversized cards.",
    ],
    gaps: [
      {
        category: "brick-vocabulary",
        severity: "blocking",
        summary:
          "Facet has no carousel primitive; horizontal shop shelves are approximated with scrollable Box rows.",
      },
      {
        category: "brick-vocabulary",
        severity: "watch",
        summary:
          "There is no avatar/image-size primitive, so exact circular avatar sizing and product-tile sizing are only approximated by media presets.",
      },
      {
        category: "asset-guidance",
        severity: "watch",
        summary:
          "The quality depends on creator-page, link-button, and product-tile presets that an agent/brand must author.",
      },
    ],
  },
  {
    id: "link-in-bio-creator",
    name: "Link-in-bio creator page",
    serviceType: "Creator page",
    goal: "Recreate a mobile-first creator landing page with avatar, short bio, stacked links, email capture, and simple analytics.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["link-in-bio-creator"],
    expectedAssets: {
      bricks: ["box", "text", "media", "richtext", "input", "keyValue"],
      presets: presets(
        { brick: "box", name: "primaryAction" },
        { brick: "box", name: "secondaryAction" },
        { brick: "media", name: "thumbnail" },
        { brick: "richtext", name: "compact" },
        { brick: "input", name: "compact" },
        { brick: "keyValue", name: "standard" },
      ),
      patterns: ["hero", "cta-button"],
    },
    referenceSources: [
      {
        label: "Official link-page templates",
        url: "https://linktr.ee/s/templates",
        useFor: "Mobile-first link stack and creator profile hierarchy.",
      },
      {
        label: "Official creator-page capabilities",
        url: "https://beacons.ai/i/app-pages/link-in-bio",
        useFor: "Creator links, analytics, email collection, and customization surface.",
      },
    ],
    targetNotes: [
      "The screen should be judged primarily at mobile width.",
      "Buttons need comfortable padding without feeling inflated.",
    ],
    qaChecklist: [
      "Avatar and bio center cleanly.",
      "Stacked actions have consistent width and rhythm.",
      "Email capture does not visually overpower the links.",
    ],
    gaps: [
      {
        category: "asset-guidance",
        severity: "watch",
        summary: "Button/badge width, padding, and rhythm are decisive for link-page quality.",
      },
      {
        category: "authoring",
        severity: "watch",
        summary:
          "A mobile-first creator page needs a custom Pattern plus screenshot review; the package defaults should not be treated as the fidelity target.",
      },
    ],
  },
  {
    id: "google-search-console-performance",
    name: "Google Search Console performance",
    serviceType: "Search analytics console",
    goal: "Recreate a Google Search Console performance report with left navigation, URL inspection search, filter chips, colored metric cards, comparison line chart, tabs, query table, and export/update chrome.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["google-search-console-performance"],
    expectedAssets: {
      bricks: ["box", "text", "media", "list", "chart", "table"],
      presets: presets(
        { brick: "box", name: "gscShell" },
        { brick: "box", name: "sideNav" },
        { brick: "box", name: "threadFilter" },
        { brick: "box", name: "gscMetricActive" },
        { brick: "box", name: "gscMetric" },
        { brick: "box", name: "reportPanel" },
        { brick: "text", name: "metricLabel" },
        { brick: "text", name: "metricValue" },
        { brick: "text", name: "body" },
        { brick: "media", name: "actionIcon" },
        { brick: "list", name: "compact" },
        { brick: "list", name: "standard" },
        { brick: "chart", name: "gscComparison" },
        { brick: "table", name: "gscQueryTable" },
      ),
      patterns: ["search-console-shell", "search-console-report-panel"],
    },
    referenceSources: [
      {
        label: "Google Search Console",
        url: "https://search.google.com/search-console",
        useFor:
          "User-provided screenshot reference for Search Console performance dashboard, comparison chart, metric cards, filter chips, and query table.",
      },
    ],
    targetNotes: [
      "Private property details are out of scope; reproduce the visible dashboard structure and density.",
      "This target is a chart/table-heavy benchmark and should be used to judge whether Facet chart output is credible.",
      "The reference includes two metric scales and previous-period dashed series; this fixture uses closed lineStyle for dashed comparisons while dual-axis scale remains approximate.",
    ],
    qaChecklist: [
      "Metric cards should align as one dense row with active blue/purple cards and inactive white cards.",
      "The line chart must not look toy-like; axes, grid, labels, and multi-series separation are the main judgment points.",
      "The query table should read as a dense analytics table, not an oversized content block.",
      "Filter chips and sidebar should preserve Google-console density without overflowing.",
    ],
    gaps: [
      {
        category: "brick-vocabulary",
        severity: "blocking",
        summary:
          "Facet Chart now covers dashed series, but still has no dual-axis, point/hover, or per-series scale controls, all visible in the reference.",
      },
      {
        category: "renderer-quality",
        severity: "blocking",
        summary:
          "This benchmark raises the bar for chart rendering: gridlines, axes, tick density, line layering, and legend treatment need product-grade polish.",
      },
      {
        category: "brick-vocabulary",
        severity: "watch",
        summary:
          "Metric cards and filter chips are approximated with Boxes/Text; a richer dashboard primitive may be justified only after repeated benchmarks show the same gap.",
      },
    ],
  },
  {
    id: "executive-report-brief",
    name: "Executive report brief",
    serviceType: "Executive reporting",
    goal: "Recreate a report/dashboard brief with prose summary, headline metrics, chart, table, risks, and pending appendix state.",
    fixture: REFERENCE_BENCHMARK_FIXTURES["executive-report-brief"],
    expectedAssets: {
      bricks: ["box", "text", "richtext", "keyValue", "chart", "table", "list", "loading"],
      presets: presets(
        { brick: "box", name: "panel" },
        { brick: "text", name: "heading" },
        { brick: "text", name: "eyebrow" },
        { brick: "richtext", name: "prose" },
        { brick: "keyValue", name: "standard" },
        { brick: "chart", name: "panel" },
        { brick: "table", name: "standard" },
        { brick: "list", name: "standard" },
        { brick: "loading", name: "subdued" },
      ),
      patterns: ["dashboard-summary", "section", "chart-table-view"],
    },
    referenceSources: [
      {
        label: "Official chart and dashboard documentation",
        url: "https://www.notion.com/help/charts",
        useFor: "Report dashboards with charts, tables, legends, and summary blocks.",
      },
    ],
    targetNotes: [
      "The screen should read as a polished executive artifact, not a raw data dump.",
      "Long-form prose, metrics, charts, and tables must share one typography system.",
    ],
    qaChecklist: [
      "Summary text is readable at report width.",
      "Chart/table pair carries a coherent hierarchy.",
      "Loading state looks intentional inside an otherwise complete report.",
    ],
    gaps: [
      {
        category: "renderer-quality",
        severity: "blocking",
        summary: "Charts need production-grade visual treatment for report credibility.",
      },
      {
        category: "authoring",
        severity: "watch",
        summary:
          "A credible executive report needs a custom chart/table/prose Pattern and manual visual QA rather than relying on package-default samples.",
      },
    ],
  },
] as const;

export function referenceBenchmarkById(id: string): ReferenceBenchmark | undefined {
  return REFERENCE_BENCHMARKS.find((benchmark) => benchmark.id === id);
}

export function benchmarkUsesBrick(benchmark: ReferenceBenchmark, brick: BrickType): boolean {
  return Object.values(benchmark.fixture.nodes).some((node) => node.type === brick);
}

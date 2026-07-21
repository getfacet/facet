import type {
  BoxStyle,
  ChartStyle,
  FacetTree,
  InputStyle,
  ListStyle,
  MediaIconName,
  MediaStyle,
  TableStyle,
  TextStyle,
} from "@facet/core";

type Node = FacetTree["nodes"][string];
type NodeMap = Record<string, Node>;

function svgData(markup: string): string {
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}

const CREATOR_AVATAR_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 240 240">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f9a8d4"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs>
  <rect width="240" height="240" rx="120" fill="url(#g)"/>
  <circle cx="120" cy="92" r="44" fill="#7c2d12" opacity=".72"/>
  <rect x="62" y="132" width="116" height="70" rx="35" fill="#111827" opacity=".78"/>
</svg>
`);

const COMMERCE_PRODUCT_A_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <rect width="420" height="420" fill="#f8fafc"/>
  <circle cx="210" cy="210" r="112" fill="#facc15"/>
  <path d="M188 118c33 18 84 34 120 16" fill="none" stroke="#166534" stroke-width="18" stroke-linecap="round"/>
  <rect x="158" y="296" width="104" height="48" rx="12" fill="#f59e0b"/>
</svg>
`);

const COUPANG_LOGO_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" width="172" height="48" viewBox="0 0 172 48">
  <text x="0" y="35" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#1f2937">coupang</text>
</svg>
`);

const COMMERCE_PRODUCT_B_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <rect width="420" height="420" fill="#f8fafc"/>
  <rect x="162" y="72" width="96" height="276" rx="36" fill="#2563eb"/>
  <rect x="178" y="164" width="64" height="92" rx="10" fill="#fef3c7"/>
  <path d="M178 244h64" stroke="#facc15" stroke-width="16"/>
</svg>
`);

const COMMERCE_PRODUCT_C_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <rect width="420" height="420" fill="#f8fafc"/>
  <rect x="78" y="122" width="112" height="176" rx="20" fill="#f97316"/>
  <rect x="210" y="122" width="112" height="176" rx="20" fill="#f97316"/>
  <rect x="104" y="166" width="62" height="64" rx="8" fill="#ecfccb"/>
  <rect x="236" y="166" width="62" height="64" rx="8" fill="#ecfccb"/>
</svg>
`);

const COMMERCE_PRODUCT_D_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420">
  <rect width="420" height="420" fill="#f8fafc"/>
  <rect x="64" y="106" width="292" height="98" rx="14" fill="#67e8f9"/>
  <rect x="88" y="220" width="244" height="86" rx="14" fill="#67e8f9"/>
  <rect x="104" y="142" width="212" height="26" rx="13" fill="#ef4444"/>
  <rect x="122" y="252" width="176" height="22" rx="11" fill="#ef4444"/>
</svg>
`);

const CREATOR_PRODUCT_A_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">
  <rect width="360" height="360" rx="18" fill="#e5e7eb"/>
  <rect x="84" y="92" width="192" height="190" rx="18" fill="#111827"/>
  <text x="180" y="190" text-anchor="middle" font-size="38" font-family="Arial" fill="#f9a8d4">REVIVAL</text>
</svg>
`);

const CREATOR_PRODUCT_B_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">
  <rect width="360" height="360" rx="18" fill="#e5e7eb"/>
  <circle cx="138" cy="190" r="78" fill="#111827"/>
  <circle cx="138" cy="190" r="28" fill="#e5e7eb"/>
  <rect x="210" y="126" width="84" height="118" rx="8" fill="#d1d5db"/>
</svg>
`);

const CREATOR_PRODUCT_C_SRC = svgData(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 360">
  <rect width="360" height="360" rx="18" fill="#e5e7eb"/>
  <path d="M116 72h128l28 228H88z" fill="#111827"/>
  <text x="180" y="194" text-anchor="middle" font-size="28" font-family="Arial" fill="#f9a8d4">Selena</text>
</svg>
`);

function box(id: string, children: readonly string[], style: BoxStyle = {}): Node {
  return { id, type: "box", children, style };
}

function text(id: string, value: string, style: TextStyle = {}): Node {
  return { id, type: "text", value, style };
}

function media(id: string, src: string, alt: string, style: MediaStyle = {}): Node {
  return { id, type: "media", kind: "image", src, alt, style };
}

function icon(id: string, name: MediaIconName, alt: string, style: MediaStyle = {}): Node {
  return { id, type: "media", kind: "icon", icon: name, alt, style };
}

function input(
  id: string,
  name: string,
  placeholder: string,
  style: InputStyle = { width: "full" },
): Node {
  return { id, type: "input", name, input: "search", placeholder, style };
}

function list(
  id: string,
  items: readonly { title: string; body?: string }[],
  style: ListStyle,
): Node {
  return { id, type: "list", items, style };
}

function chart(id: string, labels: readonly string[], style: ChartStyle): Node {
  return {
    id,
    type: "chart",
    kind: "line",
    title: "Search performance comparison",
    labels,
    series: [
      { label: "Clicks", values: [1, 1, 2, 0, 1, 1, 0], lineStyle: "solid" },
      { label: "Impressions", values: [45, 80, 230, 55, 50, 35, 20], lineStyle: "solid" },
      { label: "Previous clicks", values: [1, 0, 0, 0, 0, 0, 0], lineStyle: "dashed" },
      {
        label: "Previous impressions",
        values: [35, 38, 28, 36, 32, 35, 38],
        lineStyle: "dashed",
      },
    ],
    style,
  };
}

function table(id: string, style: TableStyle): Node {
  return {
    id,
    type: "table",
    columns: [
      { key: "query", label: "인기 검색어" },
      { key: "clicks", label: "클릭수 26. 7. 12. - 26. 7. 18.", align: "end", sortable: true },
      { key: "prevClicks", label: "클릭수 26. 7. 5. - 26. 7. 11.", align: "end" },
      { key: "diff", label: "클릭수 차이", align: "end" },
      { key: "impressions", label: "노출", align: "end" },
      { key: "prevImpressions", label: "노출 이전", align: "end" },
      { key: "impressionDiff", label: "노출 차이", align: "end" },
    ],
    rows: [
      {
        query: "ama 2",
        clicks: "3",
        prevClicks: "0",
        diff: "3",
        impressions: "317",
        prevImpressions: "23",
        impressionDiff: "294",
      },
      {
        query: "ama2",
        clicks: "3",
        prevClicks: "0",
        diff: "3",
        impressions: "143",
        prevImpressions: "119",
        impressionDiff: "24",
      },
    ],
    style,
  };
}

function action(
  id: string,
  label: string,
  preset = "secondaryAction",
  style: BoxStyle = {},
  trailingIcon: MediaIconName = "moreHorizontal",
): NodeMap {
  return {
    [id]: {
      id,
      type: "box",
      children: [`${id}-label`, `${id}-icon`],
      onPress: { kind: "agent", name: `open_${id.replaceAll("-", "_")}` },
      style: { preset, ...style },
    },
    [`${id}-label`]: text(`${id}-label`, label, { preset: "actionLabel" }),
    [`${id}-icon`]: icon(`${id}-icon`, trailingIcon, "", { preset: "actionIcon" }),
  };
}

function avatarBackgroundFor(
  color: NonNullable<TextStyle["color"]>,
): NonNullable<BoxStyle["background"]> {
  if (color === "info") return "infoSurface";
  if (color === "success") return "successSurface";
  if (color === "warning") return "warningSurface";
  return "accentSurface";
}

function avatarChip(
  id: string,
  label: string,
  color: NonNullable<TextStyle["color"]> = "accent",
): NodeMap {
  return {
    [id]: box(id, [`${id}-label`], {
      preset: "avatarChip",
      background: avatarBackgroundFor(color),
    }),
    [`${id}-label`]: text(`${id}-label`, label, {
      preset: "badge",
      color,
      fontWeight: "bold",
    }),
  };
}

function threadRow(
  id: string,
  avatar: string,
  title: string,
  body: string,
  date: string,
  avatarColor: TextStyle["color"] = "accent",
): NodeMap {
  return {
    [id]: box(id, [`${id}-avatar`, `${id}-copy`, `${id}-date`], { preset: "threadRow" }),
    ...avatarChip(`${id}-avatar`, avatar, avatarColor),
    [`${id}-copy`]: box(`${id}-copy`, [`${id}-title`, `${id}-body`], {
      gap: "xs",
      grow: true,
    }),
    [`${id}-title`]: text(`${id}-title`, title, { preset: "threadTitle" }),
    [`${id}-body`]: text(`${id}-body`, body, { preset: "threadSnippet" }),
    [`${id}-date`]: text(`${id}-date`, date, { preset: "muted" }),
  };
}

function productCard(
  id: string,
  src: string,
  alt: string,
  title: string,
  price: string,
  shipping: string,
  rating: string,
): NodeMap {
  return {
    [id]: box(id, [`${id}-img`, `${id}-title`, `${id}-price`, `${id}-shipping`, `${id}-rating`], {
      preset: "productCard",
    }),
    [`${id}-img`]: media(`${id}-img`, src, alt, { preset: "productImage" }),
    [`${id}-title`]: text(`${id}-title`, title, {
      preset: "body",
      textWrap: "wrap",
      lineClamp: 2,
    }),
    [`${id}-price`]: text(`${id}-price`, price, { preset: "price" }),
    [`${id}-shipping`]: text(`${id}-shipping`, shipping, {
      preset: "body",
      color: "success",
      fontWeight: "bold",
    }),
    [`${id}-rating`]: text(`${id}-rating`, rating, { preset: "muted" }),
  };
}

function creatorProduct(
  id: string,
  src: string,
  alt: string,
  title: string,
  price: string,
): NodeMap {
  return {
    [id]: box(id, [`${id}-img`, `${id}-title`, `${id}-price`], { preset: "productTile" }),
    [`${id}-img`]: media(`${id}-img`, src, alt, { preset: "productImage" }),
    [`${id}-title`]: text(`${id}-title`, title, {
      preset: "body",
      fontSize: "xs",
      textWrap: "wrap",
      lineClamp: 2,
    }),
    [`${id}-price`]: text(`${id}-price`, price, { preset: "muted", fontSize: "xs" }),
  };
}

function metricCard(
  id: string,
  label: string,
  current: string,
  previous: string,
  preset: "gscMetricActive" | "gscMetric",
  background?: BoxStyle["background"],
): NodeMap {
  return {
    [id]: box(id, [`${id}-label`, `${id}-current`, `${id}-previous`], {
      preset,
      grow: true,
      ...(background === undefined ? {} : { background, borderColor: background }),
    }),
    [`${id}-label`]: text(`${id}-label`, label, {
      preset: "metricLabel",
      ...(preset === "gscMetricActive" ? { color: "accentForeground" } : {}),
    }),
    [`${id}-current`]: text(`${id}-current`, current, {
      preset: "metricValue",
      ...(preset === "gscMetricActive" ? { color: "accentForeground" } : {}),
    }),
    [`${id}-previous`]: text(`${id}-previous`, previous, {
      preset: "body",
      ...(preset === "gscMetricActive" ? { color: "accentForeground" } : {}),
    }),
  };
}

export const AMA2_MESSAGES_APP_BENCHMARK_TREE: FacetTree = {
  root: "ama2-messages-root",
  nodes: {
    "ama2-messages-root": box(
      "ama2-messages-root",
      ["ama2-messages-sidebar", "ama2-messages-main"],
      { preset: "messageShell" },
    ),
    "ama2-messages-sidebar": box(
      "ama2-messages-sidebar",
      [
        "ama2-messages-brand",
        "ama2-messages-nav",
        "ama2-messages-side-spacer",
        "ama2-messages-copy-setup",
        "ama2-messages-user",
      ],
      { preset: "sideNav", width: "fit" },
    ),
    "ama2-messages-brand": box(
      "ama2-messages-brand",
      ["ama2-messages-mark", "ama2-messages-brand-text"],
      { direction: "row", gap: "sm", alignItems: "center", width: "fit" },
    ),
    "ama2-messages-mark": icon("ama2-messages-mark", "activity", "AMA2 mark", {
      preset: "navIconActive",
      iconSize: "lg",
    }),
    "ama2-messages-brand-text": text("ama2-messages-brand-text", "AMA2", {
      fontSize: "xl",
      fontWeight: "bold",
    }),
    "ama2-messages-nav": box(
      "ama2-messages-nav",
      [
        "ama2-messages-nav-active",
        "ama2-messages-nav-activity",
        "ama2-messages-nav-friends",
        "ama2-messages-nav-discovery",
        "ama2-messages-nav-settings",
      ],
      { gap: "md", width: "full" },
    ),
    "ama2-messages-nav-active": box(
      "ama2-messages-nav-active",
      ["ama2-messages-nav-active-label", "ama2-messages-nav-active-dot"],
      {
        preset: "threadFilter",
        width: "full",
        justifyContent: "between",
        background: "accentSurface",
        borderColor: "accentSurface",
      },
    ),
    "ama2-messages-nav-active-label": text("ama2-messages-nav-active-label", "Messages", {
      preset: "navItem",
      color: "accent",
    }),
    "ama2-messages-nav-active-dot": text("ama2-messages-nav-active-dot", "●", {
      color: "accent",
      fontSize: "md",
    }),
    "ama2-messages-nav-activity": text("ama2-messages-nav-activity", "Activity", {
      preset: "navItem",
    }),
    "ama2-messages-nav-friends": text("ama2-messages-nav-friends", "Friends", {
      preset: "navItem",
    }),
    "ama2-messages-nav-discovery": text("ama2-messages-nav-discovery", "Discovery", {
      preset: "navItem",
    }),
    "ama2-messages-nav-settings": text("ama2-messages-nav-settings", "Settings", {
      preset: "navItem",
    }),
    "ama2-messages-side-spacer": box("ama2-messages-side-spacer", [], { grow: true }),
    ...action(
      "ama2-messages-copy-setup",
      "Copy setup prompt",
      "primaryAction",
      {
        width: "full",
        justifyContent: "between",
        padding: "lg",
        background: "accent",
      },
      "externalLink",
    ),
    "ama2-messages-user": box(
      "ama2-messages-user",
      ["ama2-messages-user-avatar", "ama2-messages-user-name"],
      {
        direction: "row",
        gap: "md",
        padding: "lg",
        alignItems: "center",
        width: "full",
        background: "surface",
        borderRadius: "lg",
      },
    ),
    ...avatarChip("ama2-messages-user-avatar", "H", "warning"),
    "ama2-messages-user-name": text("ama2-messages-user-name", "Hoon", {
      preset: "threadTitle",
    }),
    "ama2-messages-main": box(
      "ama2-messages-main",
      ["ama2-messages-title", "ama2-messages-filter-row", "ama2-messages-thread-list"],
      { gap: "xl", padding: "2xl", width: "full", grow: true, background: "background" },
    ),
    "ama2-messages-title": text("ama2-messages-title", "Messages", {
      preset: "heading",
      fontSize: "2xl",
    }),
    "ama2-messages-filter-row": box(
      "ama2-messages-filter-row",
      [
        "ama2-filter-all",
        "ama2-filter-me",
        "ama2-filter-data",
        "ama2-filter-researcher",
        "ama2-filter-manager",
        "ama2-filter-helpdesk",
      ],
      { direction: "row", gap: "md", wrap: false, scroll: "horizontal", width: "full" },
    ),
    "ama2-filter-all": box("ama2-filter-all", ["ama2-filter-all-avatar", "ama2-filter-all-label"], {
      preset: "threadFilter",
      borderColor: "accent",
    }),
    ...avatarChip("ama2-filter-all-avatar", "AL", "accent"),
    "ama2-filter-all-label": text("ama2-filter-all-label", "All", {
      preset: "threadTitle",
      fontSize: "lg",
    }),
    "ama2-filter-me": box("ama2-filter-me", ["ama2-filter-me-avatar", "ama2-filter-me-label"], {
      preset: "threadFilter",
    }),
    ...avatarChip("ama2-filter-me-avatar", "ME", "accent"),
    "ama2-filter-me-label": text("ama2-filter-me-label", "Me", { preset: "navItem" }),
    "ama2-filter-data": box(
      "ama2-filter-data",
      ["ama2-filter-data-avatar", "ama2-filter-data-label"],
      { preset: "threadFilter" },
    ),
    ...avatarChip("ama2-filter-data-avatar", "DA", "accent"),
    "ama2-filter-data-label": text("ama2-filter-data-label", "Data Analyst", {
      preset: "navItem",
    }),
    "ama2-filter-researcher": box(
      "ama2-filter-researcher",
      ["ama2-filter-researcher-avatar", "ama2-filter-researcher-label"],
      { preset: "threadFilter" },
    ),
    ...avatarChip("ama2-filter-researcher-avatar", "RE", "info"),
    "ama2-filter-researcher-label": text("ama2-filter-researcher-label", "Researcher", {
      preset: "navItem",
    }),
    "ama2-filter-manager": box(
      "ama2-filter-manager",
      ["ama2-filter-manager-avatar", "ama2-filter-manager-label", "ama2-filter-manager-dot"],
      { preset: "threadFilter" },
    ),
    ...avatarChip("ama2-filter-manager-avatar", "MA", "info"),
    "ama2-filter-manager-label": text("ama2-filter-manager-label", "Manager", {
      preset: "navItem",
    }),
    "ama2-filter-manager-dot": text("ama2-filter-manager-dot", "●", {
      color: "accent",
      fontSize: "sm",
    }),
    "ama2-filter-helpdesk": box(
      "ama2-filter-helpdesk",
      ["ama2-filter-helpdesk-avatar", "ama2-filter-helpdesk-label", "ama2-filter-helpdesk-dot"],
      { preset: "threadFilter" },
    ),
    ...avatarChip("ama2-filter-helpdesk-avatar", "AH", "info"),
    "ama2-filter-helpdesk-label": text("ama2-filter-helpdesk-label", "AMA2 Help Desk", {
      preset: "navItem",
    }),
    "ama2-filter-helpdesk-dot": text("ama2-filter-helpdesk-dot", "●", {
      color: "accent",
      fontSize: "sm",
    }),
    "ama2-messages-thread-list": box(
      "ama2-messages-thread-list",
      [
        "ama2-thread-codex",
        "ama2-thread-live",
        "ama2-thread-hoon",
        "ama2-thread-relo",
        "ama2-thread-manager",
        "ama2-thread-researcher",
        "ama2-thread-guest",
      ],
      { gap: "md", width: "full" },
    ),
    ...threadRow(
      "ama2-thread-codex",
      "코덱",
      "코덱스",
      "안녕하세요. LiveFrame 작업을 함께하는 코덱스입니다. AMA2 설정을 마쳤어요. 이 계정은 제 에이전트 계정입니다...",
      "Jul 16",
      "accent",
    ),
    ...threadRow(
      "ama2-thread-live",
      "LI AH",
      "liveness-check, AMA2 Help Desk",
      "Hello! Quick liveness check from the owner. Please reply with a short confirmation.",
      "Jul 11  •",
      "info",
    ),
    ...threadRow(
      "ama2-thread-hoon",
      "HO AH",
      "Hoon, AMA2 Help Desk",
      "저기요.",
      "Jul 11  •",
      "success",
    ),
    ...threadRow(
      "ama2-thread-relo",
      "RE AH",
      "Relo, AMA2 Help Desk",
      "hey, enjoyed your AMA2 Show HN. if you ever want a short visual explainer...",
      "Jul 7  •",
      "info",
    ),
    ...threadRow(
      "ama2-thread-manager",
      "MA DA",
      "Manager, Data Analyst",
      "**셀프 셋업 완료** — 추측 없이 실제로 로드되는 것만 확인했습니다...",
      "Jun 18  •",
      "info",
    ),
    ...threadRow(
      "ama2-thread-researcher",
      "RE MA",
      "Researcher, Manager",
      "역할 임명 + 셀프 셋업 완료. 실제 환경을 조사해서 확인한 결과를 보고합니다...",
      "Jun 18  •",
      "info",
    ),
    ...threadRow(
      "ama2-thread-guest",
      "GT AH",
      "Guest Tester, AMA2 Help Desk",
      "잘 도착했습니다. 테스트 통과입니다.",
      "Jun 17",
      "warning",
    ),
  },
};

export const COUPANG_PRODUCT_LISTING_BENCHMARK_TREE: FacetTree = {
  root: "coupang-root",
  nodes: {
    "coupang-root": box(
      "coupang-root",
      ["coupang-ad-banner", "coupang-header", "coupang-shortcuts", "coupang-body"],
      { preset: "ecommerceShell" },
    ),
    "coupang-ad-banner": box("coupang-ad-banner", ["coupang-ad-copy"], {
      padding: "md",
      width: "full",
      alignItems: "center",
      background: "infoSurface",
      borderColor: "border",
      borderWidth: "thin",
    }),
    "coupang-ad-copy": text("coupang-ad-copy", "오늘 밤 12시까지 주문해도 로켓배송은 내일 도착!", {
      fontSize: "xl",
      fontWeight: "bold",
      color: "accent",
      textAlign: "center",
    }),
    "coupang-header": box(
      "coupang-header",
      ["coupang-category", "coupang-brand", "coupang-search", "coupang-header-icons"],
      {
        direction: "row",
        gap: "md",
        padding: "lg",
        width: "full",
        alignItems: "center",
        background: "surface",
        borderColor: "border",
        borderWidth: "thin",
      },
    ),
    "coupang-category": box(
      "coupang-category",
      ["coupang-category-menu", "coupang-category-label"],
      {
        gap: "xs",
        padding: "md",
        alignItems: "center",
        background: "accent",
        width: "fit",
      },
    ),
    "coupang-category-menu": icon("coupang-category-menu", "menu", "menu", {
      preset: "navIconActive",
      color: "accentForeground",
      iconSize: "lg",
    }),
    "coupang-category-label": text("coupang-category-label", "카테고리", {
      fontSize: "md",
      fontWeight: "bold",
      color: "accentForeground",
    }),
    "coupang-brand": media("coupang-brand", COUPANG_LOGO_SRC, "coupang wordmark", {
      width: "fit",
      aspectRatio: "wide",
      objectFit: "contain",
      borderRadius: "none",
    }),
    "coupang-search": box(
      "coupang-search",
      ["coupang-search-select", "coupang-search-input", "coupang-search-icon"],
      { preset: "searchBar", grow: true },
    ),
    "coupang-search-select": text("coupang-search-select", "전체  ˅", { preset: "body" }),
    "coupang-search-input": input(
      "coupang-search-input",
      "reference-search",
      "찾고 싶은 상품을 검색해보세요!",
    ),
    "coupang-search-icon": icon("coupang-search-icon", "search", "search", {
      preset: "actionIcon",
      color: "accent",
      iconSize: "lg",
    }),
    "coupang-header-icons": box("coupang-header-icons", ["coupang-my", "coupang-cart"], {
      direction: "row",
      gap: "lg",
      width: "fit",
    }),
    "coupang-my": box("coupang-my", ["coupang-my-icon", "coupang-my-label"], {
      gap: "xs",
      alignItems: "center",
      width: "fit",
    }),
    "coupang-my-icon": icon("coupang-my-icon", "user", "my account", {
      preset: "navIcon",
      iconSize: "lg",
    }),
    "coupang-my-label": text("coupang-my-label", "마이쿠팡", {
      preset: "body",
      textAlign: "center",
    }),
    "coupang-cart": box("coupang-cart", ["coupang-cart-icon", "coupang-cart-label"], {
      gap: "xs",
      alignItems: "center",
      width: "fit",
    }),
    "coupang-cart-icon": icon("coupang-cart-icon", "cart", "cart", {
      preset: "navIcon",
      iconSize: "lg",
    }),
    "coupang-cart-label": text("coupang-cart-label", "장바구니", {
      preset: "body",
      textAlign: "center",
    }),
    "coupang-shortcuts": box("coupang-shortcuts", ["coupang-shortcuts-copy"], {
      direction: "row",
      gap: "lg",
      padding: "md",
      width: "full",
      scroll: "horizontal",
      background: "surface",
    }),
    "coupang-shortcuts-copy": text(
      "coupang-shortcuts-copy",
      "쿠팡플레이  🚀 로켓배송  🥬 로켓프레시  다시 구매  biz 쿠팡비즈  골드박스  이달의신상  판매자특가  와우회원할인",
      { preset: "body" },
    ),
    "coupang-body": box("coupang-body", ["coupang-filter", "coupang-results"], {
      direction: "row",
      gap: "xl",
      padding: "xl",
      width: "full",
      alignItems: "start",
    }),
    "coupang-filter": box(
      "coupang-filter",
      ["coupang-filter-title", "coupang-filter-list", "coupang-category-list"],
      {
        gap: "lg",
        padding: "lg",
        width: "fit",
        background: "surface",
        borderColor: "border",
        borderWidth: "thin",
      },
    ),
    "coupang-filter-title": text("coupang-filter-title", "필터", { preset: "subheading" }),
    "coupang-filter-list": list(
      "coupang-filter-list",
      [
        { title: "🚀 로켓" },
        { title: "R.LUX 만 보기" },
        { title: "로켓배송만 보기" },
        { title: "무료배송" },
      ],
      { preset: "compact" },
    ),
    "coupang-category-list": list(
      "coupang-category-list",
      [
        { title: "생활용품" },
        { title: "헤어" },
        { title: "바디/세안" },
        { title: "구강/면도" },
        { title: "화장지/물티슈" },
        { title: "청소/주방세제" },
      ],
      { preset: "standard" },
    ),
    "coupang-results": box(
      "coupang-results",
      ["coupang-title-row", "coupang-sort-row", "coupang-product-grid"],
      { gap: "lg", width: "full", grow: true },
    ),
    "coupang-title-row": box("coupang-title-row", ["coupang-title", "coupang-page-size"], {
      direction: "row",
      justifyContent: "between",
      alignItems: "center",
      width: "full",
    }),
    "coupang-title": text("coupang-title", "생활용품", { preset: "heading", fontSize: "2xl" }),
    "coupang-page-size": text("coupang-page-size", "60개씩 보기  ˅", {
      preset: "body",
      fontWeight: "bold",
    }),
    "coupang-sort-row": text(
      "coupang-sort-row",
      "✓ 쿠팡 랭킹순  |  낮은가격순  |  높은가격순  |  판매량순  |  최신순",
      { preset: "body", color: "accent", fontWeight: "bold" },
    ),
    "coupang-product-grid": box(
      "coupang-product-grid",
      ["coupang-product-a", "coupang-product-b", "coupang-product-c", "coupang-product-d"],
      { columns: 4, gap: "xl", width: "full" },
    ),
    ...productCard(
      "coupang-product-a",
      COMMERCE_PRODUCT_A_SRC,
      "yellow household product",
      "스피셰프 나방파리 초파리 트랩 버록파리 끈끈이 제거, 3개, 29g",
      "할인 | 67%  3,900원",
      "🚀 판매자로켓  내일(수) 도착",
      "★★★★★ (6594)  최대 195원 적립",
    ),
    ...productCard(
      "coupang-product-b",
      COMMERCE_PRODUCT_B_SRC,
      "blue spray product",
      "에프킬라 수성 에어로졸 살충제 무향, 500ml, 1개",
      "28%  3,740원",
      "🚀 로켓  내일 도착",
      "★★★★★ (49360)  최대 185원 적립",
    ),
    ...productCard(
      "coupang-product-c",
      COMMERCE_PRODUCT_C_SRC,
      "orange detergent pack",
      "퐁퐁 오렌지 오일 담은 친환경 주방세제 리필, 1.2L, 2개",
      "26%  4,800원",
      "🚀 로켓  내일(수) 도착",
      "★★★★★ (50938)  최대 235원 적립",
    ),
    ...productCard(
      "coupang-product-d",
      COMMERCE_PRODUCT_D_SRC,
      "blue wet tissue pack",
      "블루나 본 퓨어 저자극 물티슈 캡형, 40g, 100매, 10개",
      "40%  7,090원",
      "🚀 로켓  내일 도착",
      "★★★★★ (8913)  최대 350원 적립",
    ),
  },
};

export const LINKTREE_SELENA_GOMEZ_BENCHMARK_TREE: FacetTree = {
  root: "creator-root",
  nodes: {
    "creator-root": box("creator-root", ["creator-page"], {
      padding: "xl",
      alignItems: "center",
      width: "full",
      minHeight: "screen",
      background: "background",
    }),
    "creator-page": box(
      "creator-page",
      [
        "creator-top-actions",
        "creator-avatar",
        "creator-handle",
        "creator-bio",
        "creator-featured-links",
        "creator-section-dark",
        "creator-dark-links",
        "creator-section-revival",
        "creator-revival-products",
        "creator-section-throwback",
        "creator-throwback-products",
        "creator-section-impact",
        "creator-impact-links",
        "creator-section-album",
        "creator-album-products",
        "creator-media-links",
      ],
      { preset: "creatorPage" },
    ),
    "creator-top-actions": box("creator-top-actions", ["creator-theme-dot", "creator-share"], {
      direction: "row",
      justifyContent: "between",
      width: "full",
    }),
    "creator-theme-dot": icon("creator-theme-dot", "settings", "theme", { preset: "actionIcon" }),
    "creator-share": icon("creator-share", "externalLink", "share", { preset: "actionIcon" }),
    "creator-avatar": media("creator-avatar", CREATOR_AVATAR_SRC, "creator avatar", {
      preset: "avatar",
      borderRadius: "full",
    }),
    "creator-handle": text("creator-handle", "@selenagomez", { preset: "creatorHandle" }),
    "creator-bio": text(
      "creator-bio",
      "“In The Dark” & “I Said I Love You First...And You Said It Back” Out Now",
      { preset: "body", textAlign: "center", fontWeight: "bold" },
    ),
    "creator-featured-links": box(
      "creator-featured-links",
      ["creator-report-link", "creator-shop-link"],
      { gap: "sm", width: "full" },
    ),
    ...action("creator-report-link", "Rare Beauty Social Impact Report", "linkButton"),
    ...action("creator-shop-link", "Selena Gomez - Revival LP - Official Shop", "linkButton"),
    "creator-section-dark": text("creator-section-dark", "In The Dark", {
      preset: "subheading",
      textAlign: "center",
      fontSize: "sm",
    }),
    "creator-dark-links": box("creator-dark-links", ["creator-listen-dark", "creator-video-dark"], {
      gap: "sm",
      width: "full",
    }),
    ...action("creator-listen-dark", "Listen to In The Dark", "linkButton"),
    ...action("creator-video-dark", "Watch the In The Dark Official Music Video", "linkButton"),
    "creator-section-revival": text("creator-section-revival", "Revival 10 Year Anniversary", {
      preset: "subheading",
      textAlign: "center",
      fontSize: "sm",
    }),
    "creator-revival-products": box(
      "creator-revival-products",
      ["creator-revival-a", "creator-revival-b", "creator-revival-c"],
      { direction: "row", gap: "sm", width: "full", scroll: "horizontal", wrap: false },
    ),
    ...creatorProduct(
      "creator-revival-a",
      CREATOR_PRODUCT_A_SRC,
      "revival product",
      "Revival 10-Year Anniversary - Store...",
      "US$70",
    ),
    ...creatorProduct(
      "creator-revival-b",
      CREATOR_PRODUCT_B_SRC,
      "revival deluxe cd",
      "Revival Deluxe CD + Journal",
      "US$50",
    ),
    ...creatorProduct(
      "creator-revival-c",
      CREATOR_PRODUCT_C_SRC,
      "revival hoodie",
      "Revival Washed Photo Hoodie",
      "US$85",
    ),
    "creator-section-throwback": text(
      "creator-section-throwback",
      "Selena Gomez Throwback Collection",
      {
        preset: "subheading",
        textAlign: "center",
        fontSize: "sm",
      },
    ),
    "creator-throwback-products": box(
      "creator-throwback-products",
      ["creator-throwback-a", "creator-throwback-b"],
      { columns: 2, gap: "sm", width: "full" },
    ),
    ...creatorProduct(
      "creator-throwback-a",
      CREATOR_PRODUCT_C_SRC,
      "throwback hoodie",
      "Spring Breakers X Selena Gomez Mask's...",
      "US$100",
    ),
    ...creatorProduct(
      "creator-throwback-b",
      CREATOR_PRODUCT_A_SRC,
      "throwback tee",
      "Spring Breakers X Selena Gomez Good...",
      "US$45",
    ),
    "creator-section-impact": text("creator-section-impact", "Rare Impact Fund", {
      preset: "subheading",
      textAlign: "center",
      fontSize: "sm",
    }),
    "creator-impact-links": box(
      "creator-impact-links",
      ["creator-impact-giving", "creator-impact-learn"],
      { gap: "sm", width: "full" },
    ),
    ...action("creator-impact-giving", "Rare Impact Fund Giving Circle", "linkButton"),
    ...action("creator-impact-learn", "Learn More About the Rare Impact Fund", "linkButton"),
    "creator-section-album": text("creator-section-album", "I SAID I LOVE YOU FIRST", {
      preset: "subheading",
      textAlign: "center",
      fontSize: "sm",
    }),
    "creator-album-products": box(
      "creator-album-products",
      ["creator-album-a", "creator-album-b"],
      {
        columns: 2,
        gap: "sm",
        width: "full",
      },
    ),
    ...creatorProduct(
      "creator-album-a",
      CREATOR_PRODUCT_C_SRC,
      "album tank",
      "Selenator Script Pink Glitter Tank",
      "US$35",
    ),
    ...creatorProduct(
      "creator-album-b",
      CREATOR_PRODUCT_B_SRC,
      "album pants",
      "Selenator Script Pink Glitter Lounge Pants",
      "US$65",
    ),
    "creator-media-links": box(
      "creator-media-links",
      ["creator-listen-album", "creator-talk", "creator-watch", "creator-collab"],
      { gap: "sm", width: "full" },
    ),
    ...action("creator-listen-album", "Listen to I Said I Love You First...", "linkButton"),
    ...action("creator-talk", "Watch Talk Music Video", "linkButton"),
    ...action("creator-watch", "Watch My Mind & Me on Apple TV+", "linkButton"),
    ...action("creator-collab", "OREO Selena Gomez | OREO", "linkButton"),
  },
};

export const GOOGLE_SEARCH_CONSOLE_PERFORMANCE_BENCHMARK_TREE: FacetTree = {
  root: "gsc-root",
  nodes: {
    "gsc-root": box("gsc-root", ["gsc-sidebar", "gsc-main"], { preset: "gscShell" }),
    "gsc-sidebar": box(
      "gsc-sidebar",
      [
        "gsc-brand",
        "gsc-property",
        "gsc-nav-main",
        "gsc-nav-indexing",
        "gsc-nav-experience",
        "gsc-sidebar-bottom",
      ],
      { preset: "sideNav", width: "fit", background: "mutedSurface", borderColor: "border" },
    ),
    "gsc-brand": text("gsc-brand", "▰ Google Search Console", {
      preset: "threadTitle",
      fontSize: "lg",
    }),
    "gsc-property": box("gsc-property", ["gsc-property-label"], {
      preset: "threadFilter",
      width: "full",
      justifyContent: "between",
    }),
    "gsc-property-label": text("gsc-property-label", "ama2.me      ˅", {
      preset: "body",
      fontWeight: "bold",
    }),
    "gsc-nav-main": list(
      "gsc-nav-main",
      [{ title: "개요" }, { title: "유용한 정보" }, { title: "실적" }, { title: "URL 검사" }],
      {
        preset: "standard",
        item: { padding: "sm", borderRadius: "full" },
        marker: { color: "accent" },
      },
    ),
    "gsc-nav-indexing": list(
      "gsc-nav-indexing",
      [{ title: "색인생성" }, { title: "페이지" }, { title: "Sitemaps" }, { title: "삭제" }],
      { preset: "compact" },
    ),
    "gsc-nav-experience": list(
      "gsc-nav-experience",
      [
        { title: "실험" },
        { title: "코어 웹 바이탈" },
        { title: "HTTPS" },
        { title: "링크" },
        { title: "설정" },
      ],
      { preset: "compact" },
    ),
    "gsc-sidebar-bottom": text("gsc-sidebar-bottom", "의견 제출하기\nSearch Console 정보", {
      preset: "muted",
    }),
    "gsc-main": box(
      "gsc-main",
      ["gsc-topbar", "gsc-title-row", "gsc-filters", "gsc-report", "gsc-table-panel"],
      { gap: "lg", padding: "xl", width: "full", grow: true, background: "mutedSurface" },
    ),
    "gsc-topbar": box("gsc-topbar", ["gsc-url-search", "gsc-export"], {
      direction: "row",
      justifyContent: "between",
      alignItems: "center",
      width: "full",
    }),
    "gsc-url-search": box("gsc-url-search", ["gsc-url-search-icon", "gsc-url-search-copy"], {
      preset: "threadFilter",
      background: "accentSurface",
      width: "full",
      maxWidth: "prose",
    }),
    "gsc-url-search-icon": icon("gsc-url-search-icon", "search", "search", {
      preset: "actionIcon",
      color: "mutedForeground",
    }),
    "gsc-url-search-copy": text("gsc-url-search-copy", "'ama2.me'에 있는 모든 URL 검사", {
      preset: "body",
      color: "mutedForeground",
    }),
    "gsc-export": box("gsc-export", ["gsc-export-icon", "gsc-export-label"], {
      direction: "row",
      gap: "xs",
      alignItems: "center",
      width: "fit",
    }),
    "gsc-export-icon": icon("gsc-export-icon", "download", "download", {
      preset: "actionIcon",
      color: "mutedForeground",
    }),
    "gsc-export-label": text("gsc-export-label", "내보내기", {
      preset: "body",
      fontWeight: "bold",
    }),
    "gsc-title-row": text("gsc-title-row", "실적", { preset: "heading", fontSize: "xl" }),
    "gsc-filters": box(
      "gsc-filters",
      [
        "gsc-filter-period",
        "gsc-filter-type",
        "gsc-filter-page",
        "gsc-filter-add",
        "gsc-filter-reset",
        "gsc-updated",
      ],
      { direction: "row", gap: "sm", width: "full", alignItems: "center", wrap: true },
    ),
    "gsc-filter-period": text("gsc-filter-period", "24시간   7일   28일   3개월   비교하기 ˅", {
      preset: "badge",
    }),
    "gsc-filter-type": text("gsc-filter-type", "검색 유형: 웹 ˅", { preset: "badge" }),
    "gsc-filter-page": text("gsc-filter-page", "페이지: https://ama2.me/ ×", { preset: "badge" }),
    "gsc-filter-add": text("gsc-filter-add", "+ 필터 추가", { preset: "badge" }),
    "gsc-filter-reset": text("gsc-filter-reset", "필터 재설정", {
      preset: "body",
      color: "accent",
      fontWeight: "bold",
    }),
    "gsc-updated": text("gsc-updated", "최종 업데이트: 7시간 전", { preset: "muted" }),
    "gsc-report": box("gsc-report", ["gsc-metrics", "gsc-chart"], { preset: "reportPanel" }),
    "gsc-metrics": box(
      "gsc-metrics",
      ["gsc-clicks", "gsc-impressions", "gsc-ctr", "gsc-position"],
      {
        direction: "row",
        gap: "none",
        width: "full",
        wrap: true,
      },
    ),
    ...metricCard("gsc-clicks", "☑ 총 클릭수", "6", "1     ---", "gscMetricActive"),
    ...metricCard(
      "gsc-impressions",
      "☑ 총 노출수",
      "519",
      "217     ---",
      "gscMetricActive",
      "info",
    ),
    ...metricCard("gsc-ctr", "☐ 평균 CTR", "1.2%", "0.5%", "gscMetric"),
    ...metricCard("gsc-position", "☐ 평균 게재순위", "6.3", "8.6", "gscMetric"),
    "gsc-chart": chart("gsc-chart", ["1", "2", "3", "4", "5", "6", "7"], {
      preset: "gscComparison",
      plot: {
        background: "surface",
        axisColor: "border",
        gridColor: "border",
        labelColor: "mutedForeground",
      },
    }),
    "gsc-table-panel": box("gsc-table-panel", ["gsc-tabs", "gsc-query-table"], {
      preset: "reportPanel",
    }),
    "gsc-tabs": text(
      "gsc-tabs",
      "검색어 수          페이지          국가          기기          검색 노출          일          ☷",
      { preset: "body", textAlign: "center", color: "mutedForeground" },
    ),
    "gsc-query-table": table("gsc-query-table", { preset: "gscQueryTable" }),
  },
};

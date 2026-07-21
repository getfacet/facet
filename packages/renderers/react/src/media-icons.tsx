import type { ReactElement } from "react";
import type { MediaIconName } from "@facet/core";

const ICON_PATHS = {
  activity: ["M22 12h-4l-3 8L9 4l-3 8H2"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18h19.8L13.7 3.9a2 2 0 0 0-3.4 0Z"],
  arrowRight: ["M5 12h14", "m12 5 5 5-5 5"],
  bell: ["M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21a2 2 0 0 0 4 0"],
  calendar: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z"],
  cart: [
    "M6 6h15l-2 8H8L6 3H3",
    "M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    "M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  ],
  check: ["m5 12 4 4L19 6"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  clock: ["M12 7v5l3 2", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"],
  database: ["M4 6c0-2 16-2 16 0s-16 2-16 0", "M4 6v6c0 2 16 2 16 0V6", "M4 12v6c0 2 16 2 16 0v-6"],
  download: ["M12 3v12", "m7 10-7 7-7-7", "M5 21h14"],
  externalLink: [
    "M14 3h7v7",
    "M10 14 21 3",
    "M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
  ],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"],
  filter: ["M3 5h18", "M6 12h12", "M10 19h4"],
  grid: ["M3 3h7v7H3Z", "M14 3h7v7h-7Z", "M14 14h7v7h-7Z", "M3 14h7v7H3Z"],
  heart: [
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z",
  ],
  help: [
    "M9.1 9a3 3 0 1 1 5.8 1c-.7 1.5-2.9 1.8-2.9 4",
    "M12 18h.01",
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  ],
  home: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h5v-6h4v6h5V9.5"],
  info: ["M12 10v7", "M12 7h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"],
  link: [
    "M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1",
    "M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1",
  ],
  mail: ["M4 4h16v16H4Z", "m4 7 8 5 8-5"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  minus: ["M5 12h14"],
  moreHorizontal: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  play: ["M8 5v14l11-7Z"],
  plus: ["M12 5v14", "M5 12h14"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z", "m21 21-4.3-4.3"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.3.6.9 1 1.6 1h.1a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z",
  ],
  sort: ["M7 7h10", "M9 12h6", "M11 17h2"],
  star: ["m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1Z"],
  table: ["M3 5h18v14H3Z", "M3 11h18", "M9 5v14", "M15 5v14"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  users: [
    "M17 21a6 6 0 0 0-12 0",
    "M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M23 21a6 6 0 0 0-5-5.9",
    "M17 3.1a4 4 0 0 1 0 7.8",
  ],
  x: ["M18 6 6 18", "M6 6l12 12"],
} satisfies Record<MediaIconName, readonly string[]>;

interface MediaIconSvgProps {
  readonly name: MediaIconName;
  readonly size: string;
}

export function MediaIconSvg({ name, size }: MediaIconSvgProps): ReactElement {
  return (
    <svg
      aria-hidden={true}
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      style={{ display: "block", flexShrink: 0 }}
    >
      {ICON_PATHS[name].map((path, index) => (
        <path d={path} key={`${name}-${String(index)}`} />
      ))}
    </svg>
  );
}

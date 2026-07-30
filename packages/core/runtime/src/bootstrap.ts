import {
  parseMarkup,
  resolveNeutralCopy,
  validateAuthorMarkup,
  validateCatalog,
  validateModalConformance,
  validateTheme,
} from "@facet/core";
import type {
  AuthorError,
  ComponentDocument,
  DataModel,
  FacetCatalog,
  FacetTheme,
} from "@facet/core";

import type { Session } from "./session.js";

export interface SessionBootstrapOptions {
  readonly catalog: FacetCatalog;
  readonly theme: FacetTheme;
  readonly copy?: unknown;
  readonly initialMarkup?: string;
}

const OPTION_KEYS: readonly string[] = ["catalog", "theme", "copy", "initialMarkup"];
const MODAL_TAG = "Modal";
const EMPTY_DATA: DataModel = Object.freeze({});

function reject(
  code: string,
  at: string,
  detail: string,
): { readonly ok: false; readonly code: string; readonly at: string; readonly detail: string } {
  return { ok: false, code, at, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(options: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(options, name) ? options[name] : undefined;
}

function authorReject(error: AuthorError): ReturnType<typeof reject> {
  return reject(
    error.code,
    `line ${error.location.line}, column ${error.location.column}`,
    error.cause,
  );
}

function initialDocument(
  source: unknown,
  catalog: FacetCatalog,
  data: DataModel,
): { readonly ok: true; readonly document: ComponentDocument | null } | ReturnType<typeof reject> {
  if (source === undefined) {
    return { ok: true, document: null };
  }
  const parsed = parseMarkup(source);
  if (!parsed.ok) {
    return authorReject(parsed.error);
  }
  const validated = validateAuthorMarkup(parsed.ast, catalog, data);
  if (!validated.ok) {
    return authorReject(validated.error);
  }
  return { ok: true, document: validated.document };
}

function sessionFrom(
  catalog: FacetCatalog,
  theme: FacetTheme,
  copy: Session["copy"],
  document: ComponentDocument | null,
): Session {
  return Object.freeze({
    catalog,
    theme,
    copy,
    document,
    data: EMPTY_DATA,
    stageRevision: 0,
    phase: document === null ? "preparing" : "live",
  });
}

export function bootstrapSession(
  options: SessionBootstrapOptions,
):
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly code: string; readonly at: string; readonly detail: string } {
  try {
    return bootstrap(options);
  } catch {
    return reject(
      "session_bootstrap_read_failed",
      "",
      "Reading the session bootstrap options threw; they must be plain data.",
    );
  }
}

function bootstrap(options: unknown): ReturnType<typeof bootstrapSession> {
  if (!isRecord(options)) {
    return reject(
      "session_bootstrap_not_an_object",
      "",
      "Session bootstrap takes one object: { catalog, theme, copy?, initialMarkup? }.",
    );
  }

  const unknownKey = Object.getOwnPropertyNames(options)
    .sort()
    .find((key) => !OPTION_KEYS.includes(key));
  if (unknownKey !== undefined) {
    return reject(
      "unknown_session_bootstrap_key",
      unknownKey,
      "The session bootstrap form is closed.",
    );
  }

  const catalog = validateCatalog(read(options, "catalog"));
  if (!catalog.ok) {
    return catalog;
  }

  const modalSpec = catalog.catalog.components.find((spec) => spec.tag === MODAL_TAG);
  if (modalSpec !== undefined) {
    const modal = validateModalConformance(modalSpec);
    if (!modal.ok) {
      return modal;
    }
  }

  const theme = validateTheme(read(options, "theme"));
  if (!theme.ok) {
    return theme;
  }

  const copy = resolveNeutralCopy(read(options, "copy"));
  if (!copy.ok) {
    return copy;
  }

  const document = initialDocument(read(options, "initialMarkup"), catalog.catalog, EMPTY_DATA);
  if (!document.ok) {
    return document;
  }

  return {
    ok: true,
    session: sessionFrom(catalog.catalog, theme.theme, copy.copy, document.document),
  };
}

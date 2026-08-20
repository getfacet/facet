import { BOUNDS } from "@facet/core";
import type {
  AuthorError,
  AuthorErrorCode,
  AuthorRepairContext,
  SourceLocation,
} from "@facet/core";

export interface ProjectedAuthorError {
  readonly code: AuthorErrorCode;
  readonly location: SourceLocation;
  readonly cause: string;
  readonly repair: string;
  readonly repairContext?: AuthorRepairContext;
}

export interface AuthorErrorResult {
  readonly ok: false;
  readonly code: "author_error";
  readonly error: ProjectedAuthorError;
}

function bounded(text: string): string {
  return text.length <= BOUNDS.frameworkCopyChars ? text : text.slice(0, BOUNDS.frameworkCopyChars);
}

export function renderAuthorError(error: AuthorError): AuthorErrorResult {
  return Object.freeze({
    ok: false as const,
    code: "author_error" as const,
    error: Object.freeze({
      code: error.code,
      location: Object.freeze({ ...error.location }),
      cause: bounded(error.cause),
      repair: bounded(error.repair),
      ...(error.repairContext === undefined ? {} : { repairContext: error.repairContext }),
    }),
  });
}

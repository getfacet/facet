import { ISSUES_SUPPRESSED, MAX_ISSUES } from "./issues.js";
import type { ThemeIssue } from "./theme-types.js";

export class IssueList {
  private readonly items: ThemeIssue[] = [];
  private suppressed = false;
  private everError = false;
  push(issue: ThemeIssue): void {
    if (issue.severity === "error") this.everError = true;
    if (this.items.length >= MAX_ISSUES) {
      if (!this.suppressed) {
        this.items.push({ severity: "warning", message: ISSUES_SUPPRESSED });
        this.suppressed = true;
      }
      return;
    }
    this.items.push(issue);
  }
  /** True iff any `error` issue was raised — even one dropped past the cap. */
  get hasError(): boolean {
    return this.everError;
  }
  get list(): ThemeIssue[] {
    return this.items;
  }
}

/** Clamp bounds in px-equivalents (invariant #5: a theme cannot push content off-screen). */

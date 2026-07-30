export type TurnTerminal = "success" | "provider_error" | "timeout" | "disconnect" | "conflict";

export interface TurnReceipt {
  readonly triggerId: string;
  readonly terminal: TurnTerminal;
  readonly settledAt: number;
}

export interface TurnToken {
  readonly id: string;
  readonly triggerId: string;
  readonly deadlineMs: number;
}

export interface HostWriteLease {
  readonly id: string;
  readonly operationId: string;
  readonly deadlineMs: number;
}

export type WriteAuthority =
  | { readonly kind: "turn"; readonly token: TurnToken }
  | { readonly kind: "host-lease"; readonly lease: HostWriteLease };

const DEFAULT_TIMEOUT_MS = 30_000;
const RECEIPT_LIMIT = 256;

interface ActiveTurn {
  readonly token: TurnToken;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function turnToken(authority: WriteAuthority | TurnToken): TurnToken | null {
  if ("kind" in authority) {
    return authority.kind === "turn" ? authority.token : null;
  }
  return authority;
}

function hostLeaseAuthority(
  authority: WriteAuthority | TurnToken,
): Extract<WriteAuthority, { readonly kind: "host-lease" }> | null {
  if ("kind" in authority && authority.kind === "host-lease") {
    return authority;
  }
  return null;
}

export class TurnGate {
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #receiptLimit: number;
  readonly #receipts = new Map<string, TurnReceipt>();
  readonly #hostLeases = new Map<string, HostWriteLease>();
  #fencedActiveTurnToken: string | null = null;
  #active: ActiveTurn | null = null;
  #nextToken = 0;

  constructor(
    options: {
      readonly now?: () => number;
      readonly timeoutMs?: number;
      readonly receiptLimit?: number;
    } = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.#receiptLimit = positiveInteger(options.receiptLimit, RECEIPT_LIMIT);
  }

  admit(
    triggerId: string,
  ):
    | { readonly outcome: "admitted"; readonly token: TurnToken }
    | { readonly outcome: "busy" }
    | { readonly outcome: "deduped"; readonly receipt: TurnReceipt } {
    this.expire();

    const retained = this.#receipts.get(triggerId);
    if (retained !== undefined) {
      return { outcome: "deduped", receipt: retained };
    }
    if (this.#active !== null) {
      return { outcome: "busy" };
    }

    const token = Object.freeze({
      id: `turn-${this.#nextToken + 1}`,
      triggerId,
      deadlineMs: this.#now() + this.#timeoutMs,
    });
    this.#nextToken += 1;
    this.#active = { token };
    return { outcome: "admitted", token };
  }

  present(authority: WriteAuthority | TurnToken): boolean {
    this.expire();

    const token = turnToken(authority);
    if (token !== null) {
      return (
        this.#active?.token.id === token.id &&
        this.#fencedActiveTurnToken !== token.id &&
        this.#now() <= token.deadlineMs
      );
    }
    const host = hostLeaseAuthority(authority);
    if (host === null) {
      return false;
    }
    return (
      this.#hostLeases.get(host.lease.id) === host.lease && this.#now() <= host.lease.deadlineMs
    );
  }

  fence(authority: WriteAuthority | TurnToken): void {
    const token = turnToken(authority);
    if (token !== null) {
      if (this.#active?.token.id === token.id) {
        this.#fencedActiveTurnToken = token.id;
      }
      return;
    }
    const host = hostLeaseAuthority(authority);
    if (host !== null) {
      this.#hostLeases.delete(host.lease.id);
    }
  }

  settle(token: TurnToken, terminal: TurnTerminal): TurnReceipt {
    const retained = this.#receipts.get(token.triggerId);
    if (retained !== undefined && this.#active?.token.id !== token.id) {
      return retained;
    }

    const receipt = Object.freeze({
      triggerId: token.triggerId,
      terminal,
      settledAt: this.#now(),
    });

    try {
      if (this.#active?.token.id === token.id) {
        this.#fencedActiveTurnToken = token.id;
        if (terminal !== "conflict") {
          this.#retain(receipt);
        }
      }
      return receipt;
    } finally {
      if (this.#active?.token.id === token.id) {
        this.#active = null;
        this.#fencedActiveTurnToken = null;
      }
    }
  }

  expire(): TurnReceipt | null {
    const active = this.#active;
    if (active === null || this.#now() <= active.token.deadlineMs) {
      return null;
    }
    return this.settle(active.token, "timeout");
  }

  mintHostLease(operationId: string): HostWriteLease {
    const lease = Object.freeze({
      id: `lease-${this.#nextToken + 1}`,
      operationId,
      deadlineMs: this.#now() + this.#timeoutMs,
    });
    this.#nextToken += 1;
    this.#hostLeases.set(lease.id, lease);
    return lease;
  }

  retainedReceiptCount(): number {
    return this.#receipts.size;
  }

  #retain(receipt: TurnReceipt): void {
    this.#receipts.delete(receipt.triggerId);
    this.#receipts.set(receipt.triggerId, receipt);
    while (this.#receipts.size > this.#receiptLimit) {
      const oldest = this.#receipts.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.#receipts.delete(oldest);
    }
  }
}

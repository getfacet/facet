import type {
  AuthorValidationResult,
  DataPath,
  FacetToolSession,
  PayloadEvaluation,
} from "@facet/core";

export interface StageOptions {
  readonly session: FacetToolSession;
}

export class Stage {
  readonly #session: FacetToolSession;
  readonly #pending = new Set<Promise<void>>();
  readonly #failures: unknown[] = [];
  #text: string | null = null;

  constructor(options: StageOptions) {
    this.#session = options.session;
  }

  render(markup: string): Promise<AuthorValidationResult> {
    return this.#track(this.#session.applyAuthorMutation(markup));
  }

  publishData(path: DataPath, value: unknown): Promise<PayloadEvaluation> {
    return this.#track(this.#session.publishData(path, value));
  }

  message(text: string): this {
    if (this.#text !== null) {
      throw new Error("A Facet turn may contain at most one conversation message.");
    }
    this.#text = text;
    return this;
  }

  flush(): { readonly text: string | null } {
    const text = this.#text;
    this.#text = null;
    return Object.freeze({ text });
  }

  async drain(): Promise<void> {
    while (this.#pending.size > 0) {
      const pending = [...this.#pending];
      await Promise.all(pending);
    }
    const failures = this.#failures.splice(0, this.#failures.length);
    if (failures.length > 0) {
      const [first] = failures;
      throw first instanceof Error ? first : new Error("A Facet stage operation failed.");
    }
  }

  #track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.then(
      () => undefined,
      (error: unknown) => {
        this.#failures.push(error);
      },
    );
    this.#pending.add(tracked);
    tracked.then(() => {
      this.#pending.delete(tracked);
    });
    return operation;
  }
}

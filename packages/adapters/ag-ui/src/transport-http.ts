import { HttpAgent } from "@ag-ui/client";

import {
  AgUiTransport,
  type AgUiAbortableAgentLike,
  type AgUiRunResult,
  type AgUiTransportOptions,
  type FacetAgUiRunInput,
} from "./transport.js";

export interface CreateHttpAgUiTransportOptions extends AgUiTransportOptions {
  readonly headers?: Record<string, string>;
  readonly fetch?: (url: string, requestInit: RequestInit) => Promise<Response>;
}

type HttpAgentConfig = ConstructorParameters<typeof HttpAgent>[0];

export function createHttpAgUiTransport(
  url: string,
  options: CreateHttpAgUiTransportOptions,
): AgUiTransport {
  const agentConfig: HttpAgentConfig = {
    url,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    fetch: normalizeAgUiFetch(options.fetch),
  };
  return new AgUiTransport(new PerRunHttpAgentSource(agentConfig), options);
}

class PerRunHttpAgentSource implements AgUiAbortableAgentLike {
  private activeAgent: HttpAgent | undefined;

  constructor(private readonly config: HttpAgentConfig) {}

  run(input: FacetAgUiRunInput): AgUiRunResult {
    const agent = new HttpAgent(this.config);
    this.activeAgent = agent;
    return agent.run(input);
  }

  abortRun(): void {
    this.activeAgent?.abortRun();
    this.activeAgent = undefined;
  }
}

function normalizeAgUiFetch(
  fetchImpl: CreateHttpAgUiTransportOptions["fetch"],
): (url: string, requestInit: RequestInit) => Promise<Response> {
  const runFetch = fetchImpl ?? ((requestUrl, requestInit) => fetch(requestUrl, requestInit));
  return async (requestUrl, requestInit) => {
    const response = await runFetch(requestUrl, requestInit);
    if (response.ok || !isEventStreamResponse(response)) return response;
    return new Response(response.body, {
      status: 200,
      statusText: "OK",
      headers: response.headers,
    });
  };
}

function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") === true;
}

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const TSX_CLI = fileURLToPath(
  new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const FACET_CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

interface CliResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const servers = new Set<Server>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.clear();
});

function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, FACET_CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function listen(server: Server): Promise<string> {
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing test address");
  return `http://127.0.0.1:${String(address.port)}`;
}

describe("facet CLI process contract", () => {
  it("posts one token-bound command frame and reports success", async () => {
    let received:
      | {
          readonly method: string | undefined;
          readonly url: string | undefined;
          readonly contentType: string | undefined;
          readonly body: unknown;
        }
      | undefined;
    const bridgeUrl = await listen(
      createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          received = {
            method: request.method,
            url: request.url,
            contentType: request.headers["content-type"],
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
          };
          response.writeHead(204).end();
        });
      }),
    );

    const result = await runCli(["say", "hello", "there"], {
      FACET_BRIDGE_URL: bridgeUrl,
      FACET_EVENT: "event-1",
    });

    expect(result).toEqual({ code: 0, stdout: "facet: say ok\n", stderr: "" });
    expect(received).toEqual({
      method: "POST",
      url: "/cmd",
      contentType: "application/json",
      body: {
        token: "event-1",
        messages: [{ kind: "say", text: "hello there" }],
      },
    });
  });

  it("returns exit 1 for a non-OK bridge response", async () => {
    const bridgeUrl = await listen(
      createServer((_request, response) => {
        response.writeHead(503).end();
      }),
    );
    const nonOk = await runCli(["say", "hello"], { FACET_BRIDGE_URL: bridgeUrl });
    expect(nonOk.code).toBe(1);
    expect(nonOk.stderr).toContain(`could not reach the bridge at ${bridgeUrl}`);
  });

  it("returns exit 2 when the bridge environment is missing", async () => {
    const missingEnv = await runCli(["say", "hello"], { FACET_BRIDGE_URL: undefined });
    expect(missingEnv.code).toBe(2);
    expect(missingEnv.stderr).toContain("FACET_BRIDGE_URL is not set");
  });
});

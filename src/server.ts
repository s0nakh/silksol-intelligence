import "./lib/error-capture";

import { createApi, type ApiEnv } from "./api/router";
import { dashboardAuthResponse } from "./api/dashboardAuth";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Node (Docker / QazCloud) reads process.env; Cloudflare passes bindings as `env`.
function serverEnv(bindings: unknown): ApiEnv {
  const proc = (globalThis as { process?: { env?: ApiEnv } }).process?.env ?? {};
  const extra =
    bindings && typeof bindings === "object"
      ? Object.fromEntries(
          Object.entries(bindings).filter((e): e is [string, string] => typeof e[1] === "string"),
        )
      : {};
  return { ...proc, ...extra };
}

let api: ((request: Request) => Promise<Response>) | undefined;

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const vars = serverEnv(env);
    if (new URL(request.url).pathname.startsWith("/api/")) {
      api ??= createApi({ env: vars });
      return api(request);
    }
    const denied = dashboardAuthResponse(request, vars);
    if (denied) return denied;
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

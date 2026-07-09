// Guardrail #1 (CLAUDE.md): This client is hardcoded to the Duffel sandbox.
// It enforces that the API key starts with "duffel_test_" and rejects anything else.
// Never swap the base URL or relax the key check without explicit human sign-off
// outside of a Claude session.

const DUFFEL_BASE_URL = "https://api.duffel.com";
const DUFFEL_VERSION = "v2";

// Exported so tests can inspect which URLs were called (acceptance criterion #5)
export const requestLog: string[] = [];

function getSandboxKey(): string {
  const key = process.env.DUFFEL_API_KEY;
  if (!key) {
    throw new Error("DUFFEL_API_KEY is not set. Add it to .env.local.");
  }
  if (!key.startsWith("duffel_test_")) {
    throw new Error(
      "DUFFEL_API_KEY must be a sandbox key (starts with duffel_test_). " +
        "Live keys are not permitted in this application. See CLAUDE.md guardrail #1."
    );
  }
  return key;
}

interface DuffelRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean>;
}

export interface DuffelErrorResponse {
  errors: Array<{
    code: string;
    type: string;
    title: string;
    message: string;
    documentation_url: string;
    source?: { field?: string; pointer?: string };
  }>;
  meta: { request_id: string; status: number };
}

export class DuffelError extends Error {
  constructor(
    public readonly response: DuffelErrorResponse,
    public readonly status: number
  ) {
    super(response.errors[0]?.message ?? "Duffel API error");
    this.name = "DuffelError";
  }
}

export async function duffelRequest<T>(
  path: string,
  options: DuffelRequestOptions = {}
): Promise<T> {
  const key = getSandboxKey();
  const { method = "GET", body, params } = options;

  const url = new URL(`${DUFFEL_BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  requestLog.push(url.toString());
  if (requestLog.length > 1000) requestLog.splice(0, requestLog.length - 1000);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Duffel-Version": DUFFEL_VERSION,
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new DuffelError(json as DuffelErrorResponse, res.status);
  }

  return (json as { data: T }).data;
}

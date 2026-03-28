import type { ToolSpecDescriptor, Tool } from "./types.js";

export interface ExecuteOptions {
  /** Auth header value (e.g., "Bearer xxx" or an API key) */
  authHeader?: string;
  /** Session ID for stateful services */
  sessionId?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

export interface ExecuteResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

/**
 * Execute a tool call against the remote service.
 * Resolves the endpoint, builds the HTTP request, and returns the response.
 */
export async function execute(
  descriptor: ToolSpecDescriptor,
  toolName: string,
  input: Record<string, unknown>,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const tool = descriptor.tools.find((t) => t.name === toolName);
  if (!tool) {
    throw new Error(`Tool not found: ${toolName}. Available: ${descriptor.tools.map((t) => t.name).join(", ")}`);
  }

  const { url, body, queryParams } = buildRequest(descriptor.base_url, tool, input);
  const headers = buildHeaders(descriptor, tool, options);

  const timeoutMs = options.timeoutMs
    ?? (tool.estimated_duration_seconds ?? descriptor.capabilities?.default_timeout_seconds ?? 30) * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchUrl = queryParams ? `${url}?${queryParams}` : url;
    const response = await fetch(fetchUrl, {
      method: tool.endpoint.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: response.status, data, headers: responseHeaders };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the request URL, body, and query parameters from tool definition and input.
 * Path parameters like {mbid} are extracted from input and interpolated.
 */
function buildRequest(
  baseUrl: string,
  tool: Tool,
  input: Record<string, unknown>
): { url: string; body: Record<string, unknown> | null; queryParams: string | null } {
  let path = tool.endpoint.path;
  const remainingInput = { ...input };

  // Extract path parameters
  const pathParams = path.match(/\{(\w+)\}/g) ?? [];
  for (const param of pathParams) {
    const key = param.slice(1, -1);
    if (key in remainingInput) {
      path = path.replace(param, encodeURIComponent(String(remainingInput[key])));
      delete remainingInput[key];
    }
  }

  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;

  // GET/DELETE: remaining params go as query string
  if (tool.endpoint.method === "GET" || tool.endpoint.method === "DELETE") {
    const entries = Object.entries(remainingInput).filter(([, v]) => v !== undefined);
    const queryParams = entries.length > 0
      ? new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
      : null;
    return { url, body: null, queryParams };
  }

  // POST/PUT/PATCH: remaining params go as body
  const hasBody = Object.keys(remainingInput).length > 0;
  return { url, body: hasBody ? remainingInput : null, queryParams: null };
}

/**
 * Build request headers from descriptor config and options.
 */
function buildHeaders(
  descriptor: ToolSpecDescriptor,
  tool: Tool,
  options: ExecuteOptions
): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "toolspec-sdk/0.1",
  };

  if (tool.endpoint.method !== "GET" && tool.endpoint.method !== "DELETE") {
    headers["Content-Type"] = tool.endpoint.content_type ?? "application/json";
  }

  if (options.authHeader) {
    const scheme = descriptor.auth?.schemes?.[0];
    const headerName = scheme?.header ?? "Authorization";
    headers[headerName] = options.authHeader;
  }

  if (options.sessionId && descriptor.state?.type === "server_managed") {
    const sessionHeader = descriptor.state.session?.header ?? "X-Session-Id";
    headers[sessionHeader] = options.sessionId;
  }

  return headers;
}

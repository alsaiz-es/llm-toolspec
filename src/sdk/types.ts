/**
 * Open LLM Tool Specification (ToolSpec) v0.1
 * Core type definitions matching the JSON Schema.
 */

export interface ToolSpecDescriptor {
  toolspec: "0.1";
  service: ServiceInfo;
  base_url: string;
  auth?: AuthConfig;
  capabilities?: Capabilities;
  state?: StateConfig;
  tools: Tool[];
  examples?: WorkflowExample[];
  knowledge?: Knowledge;
}

export interface ServiceInfo {
  name: string;
  description: string;
  version: string;
  provider?: {
    name?: string;
    url?: string;
    contact?: string;
  };
  tags?: string[];
}

export interface AuthConfig {
  required?: boolean;
  schemes?: AuthScheme[];
}

export interface AuthScheme {
  type: "api_key" | "bearer" | "oauth2" | "none";
  header?: string;
  token_url?: string;
  flow?: "client_credentials" | "authorization_code";
  scopes?: Record<string, string>;
  description?: string;
}

export interface Capabilities {
  streaming?: boolean;
  async_tasks?: boolean;
  webhooks?: boolean;
  max_payload_bytes?: number;
  default_timeout_seconds?: number;
  rate_limit?: {
    requests_per_minute?: number;
    daily_limit?: number;
  };
}

export interface StateConfig {
  type?: "stateless" | "server_managed";
  session?: {
    header?: string;
    ttl_seconds?: number;
  };
}

export interface Tool {
  name: string;
  description: string;
  when_to_use?: string;
  endpoint: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    content_type?: string;
  };
  parameters?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  response?: Record<string, unknown>;
  errors?: Array<{ code: number; description: string }>;
  estimated_duration_seconds?: number;
  idempotent?: boolean;
  streaming?: {
    supported: boolean;
    format?: "application/x-ndjson" | "text/event-stream";
  };
}

export interface WorkflowExample {
  description: string;
  steps: Array<{
    tool: string;
    input?: Record<string, unknown>;
    note?: string;
  }>;
}

export interface Knowledge {
  domain?: string;
  system_context?: string;
  workflows?: Array<{
    name: string;
    trigger: string;
    steps: string[];
    interpretation?: string;
  }>;
  glossary?: Record<string, string>;
}

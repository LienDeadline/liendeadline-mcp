/** Optional hosted analytics. The stdio entry point does not import this module. */
import { randomUUID } from "node:crypto";
import { instrument, type BeforeSendFn } from "@posthog/mcp";
import { PostHog, type PostHogOptions } from "posthog-node";

const HOSTS = new Set(["https://us.i.posthog.com", "https://eu.i.posthog.com"]);
const ENVIRONMENTS = new Set(["production", "staging", "local", "test"]);
const EVENTS = new Set(["$mcp_tool_call", "$mcp_initialize", "$mcp_tools_list"]);
const TOOLS = new Set(["calculate_supplier_deadlines", "get_state_lien_guide", "list_state_lien_guides"]);
const ERROR_TYPES = new Set(["validation", "tool", "handler", "timeout", "cancelled", "unknown"]);

function clientBucket(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const name = value.toLowerCase();
  for (const client of ["claude-code", "claude", "codex", "openai", "cursor", "vscode", "gemini"]) {
    if (name === client || name.startsWith(`${client}/`) || name.startsWith(`${client}-`)) return client;
  }
  return "unknown";
}

/** Construct a new payload so SDK additions cannot accidentally transmit caller data. */
export function privacyFilter(environment: string, version: string): BeforeSendFn {
  return (event) => {
    if (!EVENTS.has(event.event)) return null;
    const raw = event.properties;
    const properties: Record<string, unknown> = {
      environment,
      service: "mcp",
      analytics_schema: 1,
      $mcp_source: "posthog_mcp_analytics",
      $mcp_server_name: "liendeadline",
      $mcp_server_version: version,
      $mcp_client_name: clientBucket(raw.$mcp_client_name),
      $process_person_profile: false,
      $geoip_disable: true,
    };
    if (event.event === "$mcp_tool_call") {
      if (typeof raw.$mcp_tool_name !== "string" || !TOOLS.has(raw.$mcp_tool_name)) return null;
      properties.$mcp_tool_name = raw.$mcp_tool_name;
      properties.$mcp_is_error = raw.$mcp_is_error === true;
      if (typeof raw.$mcp_duration_ms === "number" && Number.isFinite(raw.$mcp_duration_ms)) {
        properties.$mcp_duration_ms = Math.max(0, raw.$mcp_duration_ms);
      }
      if (typeof raw.$mcp_error_type === "string" && ERROR_TYPES.has(raw.$mcp_error_type)) {
        properties.$mcp_error_type = raw.$mcp_error_type;
      }
    }
    return {
      event: event.event,
      distinct_id: randomUUID(),
      properties,
      timestamp: event.timestamp,
      type: "capture",
    };
  };
}

export function createHostedAnalytics(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  createClient: (token: string, options: PostHogOptions) => PostHog = (token, options) => new PostHog(token, options),
) {
  const token = env.POSTHOG_PROJECT_TOKEN ?? "";
  const host = env.POSTHOG_HOST ?? "";
  const environment = env.POSTHOG_ENVIRONMENT ?? "";
  if (env.POSTHOG_ENABLED !== "true" || !/^phc_[A-Za-z0-9]{16,200}$/.test(token)
      || !HOSTS.has(host) || !ENVIRONMENTS.has(environment)) return undefined;
  const client = createClient(token, {
    host,
    flushAt: 20,
    flushInterval: 5_000,
    maxQueueSize: 1_000,
    requestTimeout: 2_000,
    fetchRetryCount: 0,
    disableGeoip: true,
  });
  // Collector failures are isolated from tools and never print payloads or exception bodies.
  client.on("error", () => {});
  return {
    instrument(server: unknown) {
      instrument(server, client, {
        context: false,
        captureModel: false,
        enableConversationId: false,
        enableExceptionAutocapture: false,
        reportMissing: false,
        collectFeedback: false,
        identify: null,
        logger: () => {},
        beforeSend: privacyFilter(environment, version),
      });
    },
    async shutdown() {
      try {
        await client.shutdown(3_000);
      } catch {
        // Analytics is best effort; a collector outage must not prevent shutdown.
      }
    },
  };
}

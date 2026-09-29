/**
 * Thin client over the LienDeadline API.
 *
 * The supplier delivery-event calculation and state guides are public and never carry
 * credentials. The customer invoice calculation and supported-state routes require a
 * dedicated customer Bearer key. The schema is published at
 * https://liendeadline.com/api/test-api/openapi.json
 */

/** Keep in step with package.json and server.json; test/metadata.test.mjs enforces it. */
export const VERSION = "0.2.0";

export const DEFAULT_BASE_URL = "https://secure-api-v1.liendeadline.com";

const USER_AGENT = `liendeadline-mcp/${VERSION}`;

export class LienDeadlineApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LienDeadlineApiError";
  }
}

const CUSTOMER_KEY_PATTERN = /^ld_live_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/;

function apiBase(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LienDeadlineApiError("LIENDEADLINE_API_URL must be a valid HTTP(S) origin.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new LienDeadlineApiError("LIENDEADLINE_API_URL must be an HTTP(S) origin without credentials, paths, queries or fragments.");
  }
  return url;
}

function customerHeaders(baseUrl: string, apiKey?: string): Record<string, string> {
  if (apiBase(baseUrl).origin !== DEFAULT_BASE_URL) {
    throw new LienDeadlineApiError("Customer tools require LIENDEADLINE_API_URL=https://secure-api-v1.liendeadline.com; keys cannot be sent to another origin.");
  }
  if (!apiKey) {
    throw new LienDeadlineApiError("Set LIENDEADLINE_API_KEY to a dedicated customer key with deadline:calculate and states:read scopes. Browser sessions and provider tokens are not supported.");
  }
  if (!CUSTOMER_KEY_PATTERN.test(apiKey)) {
    throw new LienDeadlineApiError("LIENDEADLINE_API_KEY must be a dedicated customer key. Obtain an active key with deadline:calculate and states:read scopes through the approved issuance process.");
  }
  return { Authorization: `Bearer ${apiKey}` };
}

const INVOICE_INPUT_HINT =
  " Check that state is a supported two-letter US code and invoice_date is YYYY-MM-DD.";

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  inputHint = INVOICE_INPUT_HINT,
): Promise<T> {
  const url = new URL(path, apiBase(baseUrl));
  let res: Response;
  try {
    res = await fetch(url.href, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      // Never forward a customer key through a same- or cross-origin redirect.
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Fetch errors can contain request/credential details. Do not expose the cause.
    throw new LienDeadlineApiError("Could not reach the LienDeadline API. Check connectivity and the configured API origin; redirects are not followed.");
  }

  if (!res.ok) {
    const hint =
      res.status === 401
        ? " Check that LIENDEADLINE_API_KEY is an active, unexpired customer key; replace revoked or rotated keys."
        : res.status === 403
          ? " The customer key needs permission for this endpoint and its account."
          : res.status === 429
            ? " The API rate limit was reached; retry later."
            : res.status === 503
              ? " Customer API service is unavailable; contact the release owner."
              : res.status === 400 || res.status === 422
                ? inputHint
                : res.status === 404
                  ? " No guide exists for that state code."
                  : "";
    // Do not read or echo denial bodies, which may include sensitive content.
    throw new LienDeadlineApiError(`LienDeadline API returned ${res.status}.${hint}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new LienDeadlineApiError("LienDeadline API returned an invalid JSON response.");
  }
}

export const SUPPLIER_EVENTS_CONTRACT_VERSION = "supplier-events-v1";

const STATE_CODES = new Set(
  ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO " +
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "),
);

export type SupplierInput = {
  state: string;
  first_delivery_date: string;
  last_delivery_date?: string;
  project_type: "commercial" | "residential" | "public";
  hired_by: "owner" | "contractor" | "subcontractor";
  deliveries_complete: boolean;
  special_events_reviewed?: boolean;
  florida_final_payment_date?: string;
  florida_termination_date?: string;
};

export type SupplierDeadline = {
  name: string;
  deadline: string | null;
  days_from_now: number | null;
  required: boolean | null;
  status: "calculated" | "not_required" | "review_required" | "awaiting_final_delivery";
  description: string;
  source_url?: string;
};

export type SupplierCalculation = {
  contract_version: typeof SUPPLIER_EVENTS_CONTRACT_VERSION;
  status: "calculated" | "review_required";
  state_code: string;
  role: "supplier";
  inputs: Record<string, string | boolean>;
  preliminary_notice: SupplierDeadline;
  lien_filing: SupplierDeadline;
  critical_warnings: string[];
  statute_citations: string[];
  disclaimer: string;
};

/** Same bounds as the API: a real YYYY-MM-DD civil date between 1900 and 9998. */
function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 9998 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Mirrors the API's request validators so an agent gets an actionable local error
 * instead of an opaque 422, and so nothing is sent for a request the API would reject.
 */
export function supplierRequestBody(input: SupplierInput): Record<string, string | boolean> {
  const problems: string[] = [];
  const isFlorida = typeof input.state === "string" && input.state.toUpperCase() === "FL";
  if (typeof input.state !== "string" || !/^[A-Za-z]{2}$/.test(input.state) ||
      !STATE_CODES.has(input.state.toUpperCase())) {
    problems.push("state must be a two-letter US state or DC code");
  }
  for (const field of ["first_delivery_date", "last_delivery_date",
    "florida_final_payment_date", "florida_termination_date"] as const) {
    const value = input[field];
    if (value !== undefined && !isCivilDate(value)) problems.push(`${field} must be a real YYYY-MM-DD date`);
  }
  if (input.deliveries_complete && input.last_delivery_date === undefined) {
    problems.push("last_delivery_date is required when deliveries_complete is true");
  }
  for (const field of ["last_delivery_date", "florida_final_payment_date", "florida_termination_date"] as const) {
    const value = input[field];
    if (isCivilDate(value) && isCivilDate(input.first_delivery_date) && value < input.first_delivery_date) {
      problems.push(`${field} cannot be earlier than first_delivery_date`);
    }
  }
  if (!isFlorida && (input.florida_final_payment_date !== undefined || input.florida_termination_date !== undefined)) {
    problems.push("florida_final_payment_date and florida_termination_date apply only when state is FL");
  }
  if (problems.length > 0) throw new LienDeadlineApiError(`Invalid supplier request: ${problems.join("; ")}.`);

  // Send only supplied fields: the API rejects explicit nulls and echoes exactly what it received.
  const body: Record<string, string | boolean> = { contract_version: SUPPLIER_EVENTS_CONTRACT_VERSION };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}

function isSupplierDeadline(value: unknown): value is SupplierDeadline {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const d = value as Partial<SupplierDeadline>;
  const undated = d.status === "not_required" || d.status === "review_required" ||
    d.status === "awaiting_final_delivery";
  return typeof d.name === "string" && typeof d.description === "string" &&
    (d.required === null || typeof d.required === "boolean") &&
    (d.source_url === undefined || (typeof d.source_url === "string" && /^https?:\/\//.test(d.source_url))) &&
    (d.status === "calculated"
      ? isCivilDate(d.deadline) && Number.isFinite(d.days_from_now)
      : undated && d.deadline === null && d.days_from_now === null);
}

/**
 * The same acceptance rule the LienDeadline website applies: a matching contract, supplier
 * role and state, an exact echo of the submitted fields, and internally consistent dates.
 * Anything else is reported as an error rather than as dates.
 */
export function isVerifiedSupplierCalculation(
  value: unknown,
  body: Record<string, string | boolean>,
): value is SupplierCalculation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Partial<SupplierCalculation>;
  const inputs = r.inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return false;
  const submitted = Object.entries(body);
  const exactEcho = Object.keys(inputs).length === submitted.length &&
    submitted.every(([key, sent]) => inputs[key] === sent);
  return exactEcho &&
    r.contract_version === SUPPLIER_EVENTS_CONTRACT_VERSION &&
    r.role === "supplier" &&
    r.state_code === String(body.state).toUpperCase() &&
    (r.status === "calculated" || r.status === "review_required") &&
    isSupplierDeadline(r.preliminary_notice) &&
    isSupplierDeadline(r.lien_filing) &&
    Array.isArray(r.critical_warnings) && r.critical_warnings.every((w) => typeof w === "string") &&
    Array.isArray(r.statute_citations) && r.statute_citations.every((c) => typeof c === "string") &&
    typeof r.disclaimer === "string" && r.disclaimer.trim().length > 0;
}

/**
 * Public, stateless supplier delivery-event baselines. No credential is ever attached,
 * so this works without LIENDEADLINE_API_KEY and against any configured origin.
 */
export async function calculateSupplierDeadlines(
  baseUrl: string,
  input: SupplierInput,
): Promise<SupplierCalculation> {
  const body = supplierRequestBody(input);
  const raw = await request<unknown>(
    baseUrl,
    "/api/v1/supplier-deadlines",
    { method: "POST", body: JSON.stringify(body) },
    " Check the supplier event fields against the supplier-events-v1 schema.",
  );
  if (!isVerifiedSupplierCalculation(raw, body)) {
    throw new LienDeadlineApiError(
      "LienDeadline API returned a result that does not match the submitted supplier-events-v1 request; no dates are reported.",
    );
  }
  return raw;
}

export type DeadlineResult = {
  state: string;
  invoice_date: string;
  project_type?: string | null;
  preliminary_notice_deadline?: string | null;
  lien_deadline?: string | null;
  waiver_due_date?: string | null;
  prelim_deadline_days?: number | null;
  lien_deadline_days?: number | null;
  warnings?: string[];
  notes?: string;
};

export type CalculateInput = {
  state: string;
  invoice_date: string;
  project_type?: string;
  notice_date?: string;
  role?: string;
};

/**
 * The API echoes the same object three times (`data`, `result`, and flattened at the top
 * level). Returning all three would triple the tokens a client pays for identical content,
 * so collapse to one and keep only the fields an agent can act on.
 */
export async function calculateDeadline(
  baseUrl: string,
  input: CalculateInput,
  apiKey?: string,
): Promise<DeadlineResult> {
  const raw = await request<Record<string, unknown>>(baseUrl, "/api/v1/calculate-deadline", {
    method: "POST",
    headers: customerHeaders(baseUrl, apiKey),
    body: JSON.stringify(input),
  });
  const payload = (raw.data ?? raw.result ?? raw) as Record<string, unknown>;
  return {
    state: String(payload.state ?? input.state),
    invoice_date: String(payload.invoice_date ?? input.invoice_date),
    project_type: (payload.project_type as string | null) ?? null,
    preliminary_notice_deadline: (payload.preliminary_notice_deadline as string | null) ?? null,
    lien_deadline: (payload.lien_deadline as string | null) ?? null,
    waiver_due_date: (payload.waiver_due_date as string | null) ?? null,
    prelim_deadline_days: (payload.prelim_deadline_days as number | null) ?? null,
    lien_deadline_days: (payload.lien_deadline_days as number | null) ?? null,
    warnings: (payload.warnings as string[] | undefined) ?? [],
    notes: (payload.notes as string | undefined) ?? "",
  };
}

export async function listSupportedStates(baseUrl: string, apiKey?: string): Promise<string[]> {
  const raw = await request<{ states?: string[] }>(baseUrl, "/api/v1/supported-states", {
    headers: customerHeaders(baseUrl, apiKey),
  });
  return raw.states ?? [];
}

export type StateGuideSummary = {
  state_code: string;
  title: string;
  slug: string;
};

export async function listStateGuides(baseUrl: string): Promise<StateGuideSummary[]> {
  const raw = await request<{ states?: StateGuideSummary[] }>(
    baseUrl,
    "/api/v1/state-guides/index",
  );
  return (raw.states ?? []).map((s) => ({
    state_code: s.state_code,
    title: s.title,
    slug: s.slug,
  }));
}

export type StateGuide = {
  state_code: string;
  title: string;
  slug: string;
  rules: unknown;
  deadline_rows: unknown;
  faqs: unknown;
  source_url: string;
};

/**
 * A full guide is ~16 KB, of which ~7 KB is rendered HTML that an agent cannot use.
 * Return only the structured fields, which carry the statute citations.
 */
export async function getStateGuide(baseUrl: string, stateCode: string): Promise<StateGuide> {
  const code = stateCode.trim().toUpperCase();
  const raw = await request<Record<string, unknown>>(
    baseUrl,
    `/api/v1/state-guides/${encodeURIComponent(code)}`,
  );
  const g = (raw.data ?? raw) as Record<string, unknown>;
  const slug = String(g.slug ?? code.toLowerCase());
  return {
    state_code: String(g.state_code ?? code),
    title: String(g.title ?? code),
    slug,
    rules: g.rule_payload ?? null,
    deadline_rows: g.deadlines_rows_json ?? null,
    faqs: g.faq_json ?? null,
    source_url: `https://liendeadline.com/state-lien-guides/${slug}`,
  };
}

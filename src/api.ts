/**
 * Thin client over the public LienDeadline API.
 *
 * Every endpoint used here is public and unauthenticated as of 2026-08-19, which is
 * what makes this server useful without an API key. The schema is published at
 * https://liendeadline.com/api/test-api/openapi.json
 */

export const DEFAULT_BASE_URL = "https://secure-api-v1.liendeadline.com";

const USER_AGENT = "liendeadline-mcp/0.1.0";

export class LienDeadlineApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LienDeadlineApiError";
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new LienDeadlineApiError(`Could not reach the LienDeadline API: ${reason}`);
  }

  if (!res.ok) {
    // Surface the status. A 422 here almost always means an unsupported state code or a
    // date that is not YYYY-MM-DD, and saying so is more useful than the raw body.
    const hint =
      res.status === 400 || res.status === 422
        ? " Check that state is a supported two-letter US code (call list_supported_states) and" +
          " that invoice_date is YYYY-MM-DD."
        : res.status === 404
          ? " No guide exists for that state code."
          : "";
    throw new LienDeadlineApiError(`LienDeadline API returned ${res.status}.${hint}`, res.status);
  }
  return (await res.json()) as T;
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
): Promise<DeadlineResult> {
  const raw = await request<Record<string, unknown>>(baseUrl, "/api/v1/calculate-deadline", {
    method: "POST",
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

export async function listSupportedStates(baseUrl: string): Promise<string[]> {
  const raw = await request<{ states?: string[] }>(baseUrl, "/api/v1/supported-states");
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

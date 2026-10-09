# Tool reference

This is the precise reference for the LienDeadline MCP tools: inputs, results, statuses and the
checks the server runs. For setup, see the [README](../README.md).

The server has seven tools. All of them are read-only: they calculate or read, and none sends a
notice, files a lien or makes a payment. Every tool is annotated `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`.

| Server | Tools | Key |
| --- | --- | --- |
| Hosted endpoint, `https://mcp.liendeadline.com/mcp` | The five public tools | None |
| Local npm package (`npx -y liendeadline-mcp`, stdio) | The five public tools and the two customer tools | Customer tools only. See [CUSTOMER-API.md](CUSTOMER-API.md). |

Both servers define the public tools with the same code, so their names, descriptions and schemas
match. [HOSTED.md](HOSTED.md) covers the hosted transport. When a client connects, both servers
also send usage guidance in the MCP `instructions` field. The hosted server leaves out the part
about customer tools.

Results are calculated baselines, not legal advice.

Also on this page: [statuses at a glance](#statuses-at-a-glance),
[response trimming](#response-trimming), [errors](#errors) and
[upstream requests](#upstream-requests).

## Which tool when

| You want to | Use | Notes |
| --- | --- | --- |
| Get notice and lien dates for a Florida or Kansas private project from delivery dates | [`calculate_supplier_deadlines`](#calculate_supplier_deadlines) | Contract `supplier-events-v2`. Other states and public projects return `review_required`. |
| Learn which facts matter for a state, project type and hiring relationship, and whether v3 supports that scope | [`get_supplier_questions`](#get_supplier_questions) | Step 1 of the [v3 flow](#discovered-supplier-facts-v3). |
| Get outcomes from answers to the discovered questions | [`calculate_supplier_deadlines_v3`](#calculate_supplier_deadlines_v3) | Step 2 of the v3 flow. Needs the identities from step 1. |
| Explain the rules behind a date, or cite the statute | [`get_state_lien_guide`](#get_state_lien_guide) | Editorial guide, not a calculation. |
| Find valid state codes, or list every guide | [`list_state_lien_guides`](#list_state_lien_guides) | All 50 states and DC. |
| Get deadlines for one invoice | [`calculate_lien_deadline`](#calculate_lien_deadline) | Local package and customer key only. |
| See which jurisdictions the invoice calculation accepts | [`list_supported_states`](#list_supported_states) | Local package and customer key only. |

The server instructions tell agents to start a jurisdiction-specific question with
`get_supplier_questions`. A 503 from discovery means the reviewed v3 rules for that request are
not released yet. `calculate_supplier_deadlines` still covers Florida and Kansas private projects.

## Conventions

- **Results.** A successful call returns one text content item that holds pretty-printed JSON.
  There is no `structuredContent` and no output schema, so parse the text.
- **Errors.** A failed call returns `isError: true` with one plain-text message and no dates. See
  [Errors](#errors).
- **Dates.** Dates use `YYYY-MM-DD`. The supplier tools also require a real calendar date from
  1900 through 9998, so `2026-02-30` fails.
- **Optional fields.** Leave out an optional field you don't have. `null` is not accepted.
- **Undeclared fields.** Top-level arguments that a tool doesn't declare are dropped before the
  tool runs, so they never reach the API. The nested objects of
  `calculate_supplier_deadlines_v3` are strict: an undeclared field inside them fails validation.
- **Event answers.** Event questions take `yes`, `no` or `unknown`. `unknown` is a valid answer,
  and a deadline that depends on an unknown fact stays under review. Ask for a missing fact; don't
  guess it.
- **One request per call.** A call makes at most one request to the LienDeadline API. A call that
  fails a local check makes none.

## Supplier deadlines from delivery events (v2)

### `calculate_supplier_deadlines`

Calculates a material supplier's preliminary notice and lien filing deadlines from delivery
events, under contract `supplier-events-v2`. Public and stateless: no key, and nothing is stored.

Calculated dates are available for Florida (`FL`) and Kansas (`KS`) private projects, meaning
`commercial` or `residential`. Every other state, Texas included, and every `public` project
returns `review_required`. That is a valid result, not an error.

#### Inputs

| Name | Type | Required | Allowed values and meaning |
| --- | --- | --- | --- |
| `state` | string of two letters | Yes | Code of the state where the project is located, for example `FL`, `KS` or `TX`. Any US state or `DC`. Decides which event questions apply. |
| `first_delivery_date` | string, `YYYY-MM-DD` | Yes | Date materials were first delivered (first furnishing). Not an invoice date. |
| `last_delivery_date` | string, `YYYY-MM-DD` | When `deliveries_complete` is `true` | Date of the final delivery. Not earlier than `first_delivery_date`. |
| `project_type` | `commercial`, `residential` or `public` | Yes | Private commercial, private residential, or public. Public projects always need review. |
| `hired_by` | `owner`, `contractor` or `subcontractor` | Yes | Who ordered the materials from the supplier. |
| `deliveries_complete` | boolean | Yes | `true` when the final delivery has happened. `false` while deliveries are ongoing, which returns `awaiting_final_delivery` for the lien date. |
| `florida_final_payment_status` | `yes`, `no` or `unknown` | No. Florida only. | Did the owner make final payment to the contractor? Use `unknown` when it isn't verified. For suppliers not hired by the owner, `unknown`, omitted, or `yes` without `florida_final_payment_date` makes preliminary notice `review_required`. |
| `florida_final_payment_date` | string, `YYYY-MM-DD` | No. Florida only, with `yes`. | The owner's final-payment date. Not earlier than `first_delivery_date`. |
| `florida_termination_status` | `yes`, `no` or `unknown` | No. Florida only. | Was the original contract or the notice of commencement terminated? `no` permits the lien baseline. `yes`, `unknown` or omitted requires qualified lien review. |
| `florida_termination_date` | string, `YYYY-MM-DD` | No. Florida only, with `yes`. | Termination date of the contract or notice of commencement. Not earlier than `first_delivery_date`. A lien date still requires qualified review. |
| `kansas_extension_status` | `yes`, `no` or `unknown` | No. Kansas only. | Was a statutory lien-period extension filed and mailed? `no` permits the ordinary lien baseline. `yes`, `unknown` or omitted requires qualified review. |

#### Checks before any request

The server rejects the call, without contacting the API, when:

- `state` isn't a US state or DC code, such as `ZZ`;
- a date isn't a real calendar date;
- `deliveries_complete` is `true` and `last_delivery_date` is missing;
- `last_delivery_date`, `florida_final_payment_date` or `florida_termination_date` is earlier
  than `first_delivery_date`;
- a Florida field is sent for a state other than `FL`, or `kansas_extension_status` for a state
  other than `KS`;
- a Florida date is sent without the matching `yes` answer.

The error names every problem by field, for example:
`Invalid supplier request: last_delivery_date is required when deliveries_complete is true.`

There is no blanket `special_events_reviewed` flag. The schema doesn't declare one, so it is
dropped if a client sends it, and each Florida or Kansas question still needs its own answer.

Delivery dates are furnishing dates. Never substitute an invoice date.

#### Florida and Kansas event answers

Answer each Florida or Kansas question with `yes`, `no` or `unknown`. An omitted answer counts as
unresolved, the same as `unknown`. An unresolved answer holds only the deadline it affects.

| State | Field | Answer that permits a date | Any other answer, or omitted |
| --- | --- | --- | --- |
| FL | `florida_final_payment_status` | `no`, or `yes` with `florida_final_payment_date` | The notice is `review_required` when a contractor or subcontractor hired the supplier |
| FL | `florida_termination_status` | `no` | The lien is `review_required` |
| KS | `kansas_extension_status` | `no` | The lien is `review_required` |

The server enforces the final-payment row only when a contractor or subcontractor hired the
supplier; for a supplier hired by the owner, it doesn't require a final-payment answer. An
answer that permits a date doesn't guarantee one: the other facts still apply.

#### Ongoing deliveries

While deliveries continue, set `deliveries_complete` to `false`. When the other facts permit a
lien baseline, the lien outcome is `awaiting_final_delivery`, with no date. When another answer
already holds the lien, such as a Florida termination answer other than `no`, the lien is
`review_required` instead. Call the tool again after the final delivery.

#### Example

A Florida commercial project where a subcontractor ordered the materials, deliveries ran from
2026-08-03 to 2026-09-10, and the owner confirms neither final payment nor termination occurred:

```json
{
  "state": "FL",
  "first_delivery_date": "2026-08-03",
  "last_delivery_date": "2026-09-10",
  "project_type": "commercial",
  "hired_by": "subcontractor",
  "deliveries_complete": true,
  "florida_final_payment_status": "no",
  "florida_termination_status": "no"
}
```

returns, abbreviated:

```json
{
  "contract_version": "supplier-events-v2",
  "status": "calculated",
  "state_code": "FL",
  "preliminary_notice": { "name": "Notice to Owner", "deadline": "2026-09-17", "status": "calculated" },
  "lien_filing": { "name": "Claim of lien", "deadline": "2026-12-09", "status": "calculated" },
  "statute_citations": ["Fla. Stat. § 713.06(2)(a)", "Fla. Stat. § 713.08(5)"],
  "disclaimer": "This is an educational baseline, not legal advice ..."
}
```

The same facts with both Florida answers omitted return `"status": "review_required"` and no
dates.

#### Response

| Field | Meaning |
| --- | --- |
| `contract_version` | Always `supplier-events-v2`. |
| `status` | Overall status: `calculated` or `review_required`. |
| `state_code` | Your state, in uppercase. |
| `role` | Always `supplier`. |
| `inputs` | Exact echo of the fields you sent, plus `contract_version`. |
| `preliminary_notice`, `lien_filing` | One deadline object each. |
| `critical_warnings` | Warnings to show the user. |
| `statute_citations` | Statutes behind the result. |
| `disclaimer` | Not legal advice. |

Each deadline object has `name`, `status`, `deadline`, `days_from_now`, `required` (`true`,
`false` or `null`), `description` and, when available, a statute `source_url`. Its `status` is
`calculated`, `not_required`, `review_required` or `awaiting_final_delivery`. Only `calculated`
carries a `deadline` and `days_from_now`; every other status has `null` in both.
`days_from_now` is negative once the date has passed.

The overall status is only ever `calculated` or `review_required`. A `calculated` result can
still hold a deadline with no date, such as `not_required` or `awaiting_final_delivery`, so read
each deadline's own status before you use its date.

#### What the server verifies

Before it returns a result, the server checks that:

- `inputs` has exactly the fields you sent plus `contract_version`, with the same values;
- `contract_version` is `supplier-events-v2`, `role` is `supplier` and `state_code` is your state
  in uppercase;
- the overall `status` is `calculated` or `review_required`;
- each `calculated` deadline has a real date and a day count, and every other status has neither;
- each `source_url` is an `http` or `https` link;
- `critical_warnings` and `statute_citations` are lists of strings, and `disclaimer` isn't empty;
- every unresolved Florida or Kansas answer in the table above leaves its deadline, and the
  overall status, at `review_required`.

If any check fails, the tool returns an error and no dates:
`LienDeadline API returned a result that does not match the submitted supplier-events-v2 request; no dates are reported.`

## Discovered supplier facts (v3)

The v3 tools use contract `supplier-events-v3` and work in two steps. Discovery returns the
questions that matter for one scope, with identities for the exact rules behind them. The
calculation evaluates your answers against those exact rules.

1. Call `get_supplier_questions` with `state`, `project_type` and `hired_by`.
2. Ask the questions that apply (see [conditional questions](#conditional-questions)). Accept
   `unknown`. Never guess.
3. Call `calculate_supplier_deadlines_v3` with the same scope, the `rules_source` and
   `questions_identity` copied unchanged from step 1, and your answers in `events`.
4. If the calculation returns 409, the rules or questions changed after step 1. Start again at
   step 1 and confirm the facts against the new questions.

**Availability.** v3 states are added as each state's reviewed rules are released. Until then, a
request for that state currently returns a 503 error, with no questions or dates. Neither a 409
nor a 503 implies coverage. For Florida and Kansas private projects, `calculate_supplier_deadlines`
remains available.

### `get_supplier_questions`

Returns the current v3 scope support for a material supplier: yes/no/unknown event questions,
date policies, sources, and the exact rule and question identities. Public and read-only. It
needs no key and no delivery dates.

| Name | Type | Required | Allowed values and meaning |
| --- | --- | --- | --- |
| `state` | string of two letters | Yes | Project jurisdiction: a US state or `DC`. |
| `project_type` | `commercial`, `residential` or `public` | Yes | The project type. |
| `hired_by` | `owner`, `contractor` or `subcontractor` | Yes | Who hired the supplier. |

The server adds `contract_version: "supplier-events-v3"` and `role: "supplier"` to the request.

The result has these fields:

| Field | Meaning |
| --- | --- |
| `contract_version` | Always `supplier-events-v3`. |
| `scope` | Your scope, echoed back: `contract_version`, `state` (uppercase), `role`, `project_type` and `hired_by`. |
| `scope_status` | `supported`, `no_lien_right` or `review_required`. |
| `reason_code`, `description` | A code and a plain-text explanation of the scope status. |
| `rules_source` | Identity of the reviewed rules. Pass it to the calculation unchanged. |
| `questions_identity` | Identity of this question set. Pass it to the calculation unchanged. |
| `questions` | Up to 64 questions, in the order to ask them. |
| `sources` | Citations, each with `id`, `section` and an HTTPS `official_url`. |
| `exclusions`, `warnings` | Exclusions and warnings for this scope, as lists of strings. |

Each question has these fields:

| Field | Meaning |
| --- | --- |
| `id` | The event ID: the key for this answer in `events`. |
| `label`, `help` | The question and its help text. |
| `answers` | Always `["yes", "no", "unknown"]`. |
| `date_policy` | `required_for_calculation_if_yes`: a `yes` answer needs a date for a calculated outcome. `optional_review_only`: a date may go with `yes`, for review only. `forbidden`: never send a date. |
| `applies_when` | `{ "all": [ { "event": "<earlier question id>", "answer": "yes" } ] }`. Each condition names an earlier question and an answer of `yes` or `no`. An empty list means the question always applies. |
| `affects` | What the answer can change: one or more of `preliminary_notice`, `lien_filing` and `eligibility`. |
| `source_ids` | IDs of the `sources` behind the question. |

#### Conditional questions

A question applies when every condition in `applies_when.all` names a question that applies and
matches its answer. Conditions only point to earlier questions, so you can walk the list in order.

- An `unknown` answer matches no condition. Questions that depend on it don't apply, so leave them
  out.
- If an earlier answer changes, drop the answers to questions that no longer apply. Don't submit
  facts collected under a different branch.

`applicableQuestions` and `discoveredEvents` in [`src/supplier-v3.ts`](../src/supplier-v3.ts)
implement these rules.

#### What the server verifies

Before it returns discovery, the server checks that:

- `scope` matches your request, with the state in uppercase;
- `scope_status` is `supported`, `no_lien_right` or `review_required`;
- `rules_source` and `questions_identity` are well formed;
- every source has a unique `id`, a `section` and an HTTPS `official_url` without credentials;
- every question has a unique, valid ID, the answers `yes`, `no` and `unknown`, a known date
  policy, at least one `affects` value and at least one known source;
- every condition points to an earlier question;
- a question with the ID `homestead` has the date policy `forbidden`.

If any check fails, the tool returns an error and no questions:
`Supplier discovery could not be verified for this scope; no questions or dates are reported.`

### `calculate_supplier_deadlines_v3`

Evaluates v3 project facts against the exact discovered rule and question identities. Returns
independent notice and lien outcomes, each with its own status and sources, and an exact nested
echo of the request. Only `calculated` outcomes contain statutory deadline dates. Public,
stateless and read-only.

| Name | Type | Required | Allowed values and meaning |
| --- | --- | --- | --- |
| `state` | string of two letters | Yes | A US state or `DC`. Use the same scope as discovery. |
| `project_type` | `commercial`, `residential` or `public` | Yes | Same as discovery. |
| `hired_by` | `owner`, `contractor` or `subcontractor` | Yes | Same as discovery. |
| `rules_source` | object, strict | Yes | The exact `rules_source` from discovery for this scope. |
| `questions_identity` | object, strict | Yes | The exact `questions_identity` from discovery. |
| `events` | object | Yes | Map from discovered event ID to an answer object. A missing event means `unknown`; `{}` sends no answers. |

`rules_source` has exactly these fields:

| Field | Value |
| --- | --- |
| `schema_version` | `state-rules-v1` or `state-rules-v2` |
| `source_version` | string; discovery returns the form `YYYY-MM-DD.N` |
| `source_hash` | 64 lowercase hex characters |
| `reviewed_commit` | 40 lowercase hex characters |
| `supplier_engine_version` | string |
| `implementation_manifest_hash` | 64 lowercase hex characters |

`questions_identity` has exactly two fields: `questions_version`, which is
`supplier-questions-v1`, and `question_set_hash`, which is 64 lowercase hex characters.

Each `events` entry is an object with `answer` (`yes`, `no` or `unknown`) and an optional `date`
(`YYYY-MM-DD`). No other fields are allowed. The rules:

- Use only event IDs from discovery. An ID is a lowercase letter followed by up to 79 lowercase
  letters, digits or underscores.
- Send at most 64 events.
- Send a `date` only with `yes`, and only where the question's `date_policy` permits it. Never
  send a date for `homestead`, and never send `"date": null`.
- A date must be a real calendar date.
- A `final_furnishing` date can't be earlier than a `first_furnishing` date.
- Invoice dates are not furnishing dates.

The server adds `contract_version: "supplier-events-v3"` and `role: "supplier"`. The request
shape, with placeholders in angle brackets:

```json
{
  "state": "<state>",
  "project_type": "commercial",
  "hired_by": "contractor",
  "rules_source": {
    "schema_version": "<from discovery>",
    "source_version": "<from discovery>",
    "source_hash": "<from discovery>",
    "reviewed_commit": "<from discovery>",
    "supplier_engine_version": "<from discovery>",
    "implementation_manifest_hash": "<from discovery>"
  },
  "questions_identity": {
    "questions_version": "supplier-questions-v1",
    "question_set_hash": "<from discovery>"
  },
  "events": {
    "<question id>": { "answer": "yes", "date": "2026-06-01" },
    "<another question id>": { "answer": "unknown" }
  }
}
```

The result has these fields:

| Field | Meaning |
| --- | --- |
| `contract_version` | Always `supplier-events-v3`. |
| `status` | Overall status. See [outcome statuses](#outcome-statuses). |
| `as_of_date` | The date the API evaluated the request. `days_from_now` counts from it. |
| `state_code` | Your state, in uppercase. |
| `role` | Always `supplier`. |
| `inputs` | Exact nested echo of the full request, including the `contract_version` and `role` the server adds. |
| `rules_source`, `questions_identity` | The identities you sent. |
| `preliminary_notice`, `lien_filing` | One outcome each. |
| `sources` | Citations, each with `id`, `section` and an HTTPS `official_url`. |
| `critical_warnings` | Warnings to show the user. |
| `disclaimer` | Not legal advice. |

Each outcome has these fields:

| Field | Meaning |
| --- | --- |
| `name` | The name of the notice or filing. |
| `status` | `calculated`, `not_required`, `no_lien_right`, `awaiting_final_delivery` or `review_required`. |
| `deadline` | The date, only when `status` is `calculated`. Otherwise `null`. |
| `days_from_now` | Whole days from `as_of_date` to `deadline`, only when `calculated`. Otherwise `null`. Negative once the date has passed. |
| `required` | `true` for `calculated` and `awaiting_final_delivery`. `false` for `not_required` and `no_lien_right`. `null` for `review_required`. |
| `description`, `reason_code` | Why the outcome has this status. |
| `event_ids` | The events behind the outcome. |
| `source_ids` | IDs from `sources`. At least one for `calculated`, `not_required` and `no_lien_right`. |
| `action_by` | Optional verified Conservative action date planning target, only on `review_required` with reason `conservative_action_date`. Absent when unavailable; never a statutory deadline. |
| `candidate_deadlines` | Optional raw statutory candidates. See [candidate deadlines](#candidate-deadlines). |

#### Outcome statuses

The notice and the lien are evaluated independently, and each outcome keeps its own status. The
overall `status` is:

1. `review_required` if either outcome is `review_required`;
2. otherwise `no_lien_right` if the outcomes are `no_lien_right`, which always covers both;
3. otherwise `awaiting_final_delivery` if either outcome is `awaiting_final_delivery`;
4. otherwise `calculated`. Each outcome is then `calculated` or `not_required`.

`no_lien_right` differs from `not_required`. `not_required` means this notice or filing isn't
required for these facts. `no_lien_right` means the supplier has no lien right in this scope, and
it always applies to both outcomes.

#### Candidate deadlines

An outcome with status `calculated` or `review_required` can include `candidate_deadlines`: up to
16 entries, each with an `id`, a `date` and `source_ids`. They are raw statutory candidates, never
filing deadlines.

- Never use a candidate in place of a missing `deadline`.
- Never resolve candidates by picking the earlier date, or any other date.
- A `review_required` outcome with candidates still needs qualified review.
- On a `calculated` outcome, the date is `deadline`. Candidates don't change it.

#### Conservative action dates

A verified `review_required` outcome may explicitly return `action_by` with reason
`conservative_action_date`. It is a planning target while the statutory deadline remains
unresolved. Label it **Conservative action date**, retain **Qualified review required**, and show
the description, sources and critical warnings. Obtain qualified review before that date.
Never infer an action date from candidates, guides or memory. There is no statutory countdown.

The server requires a valid civil date no later than every raw candidate, nonempty source
attribution, nonempty valid candidates and critical warnings. `deadline`, `days_from_now` and
`required` remain `null`; the overall status remains `review_required`. An absent `action_by`
provides no target. A malformed or inconsistent action date fails verification.

#### What the server verifies

Before it returns a result, the server checks that:

- `inputs` equals the full request exactly, nested objects included;
- `rules_source` and `questions_identity` equal the ones you sent;
- `contract_version` is `supplier-events-v3`, `role` is `supplier` and `state_code` is your state
  in uppercase;
- `as_of_date` is a real date, every source has a unique `id`, a `section` and an HTTPS
  `official_url`, and every `source_ids` entry points to a listed source;
- `critical_warnings` is a list of strings, and `disclaimer` isn't empty;
- each outcome's `required`, `deadline` and `days_from_now` match its status, and
  `days_from_now` equals the days from `as_of_date` to `deadline`;
- candidate deadlines have unique IDs, real dates and known sources, and appear only on
  `calculated` or `review_required` outcomes;
- `no_lien_right` appears on both outcomes or on neither;
- the overall `status` follows from the two outcomes.

If any check fails, the tool returns an error and no dates:
`Supplier result does not match the exact submitted facts and rule identities; no dates are reported.`

### 409 and 503

| Status | Meaning | What to do |
| --- | --- | --- |
| 409 | The `rules_source` or `questions_identity` you sent is stale: the rules or the question set changed after discovery. | Call `get_supplier_questions` again, confirm the facts against the new questions and calculate with the new identities. Never reuse stale identities. |
| 503 | The reviewed rule source, or its implementation, isn't available. Today this means the state's reviewed v3 rules aren't released yet. | Don't infer coverage or a date from it. For Florida and Kansas private projects, use `calculate_supplier_deadlines`. |

The tools return these messages:

- 409: `LienDeadline API returned 409. Supplier rules changed. Discover the project questions again and reconfirm the facts before retrying; do not reuse stale rule identities.`
- 503: `LienDeadline API returned 503. The requested API service is unavailable; no deadline was calculated. Retry when the reviewed source is available.`

## State lien guides

### `get_state_lien_guide`

Returns LienDeadline's editorial mechanics lien and preliminary notice guide for one state or DC.
Use it to explain how a state's rules work, why a deadline falls where it does, or which statute
applies. Public and read-only.

| Name | Type | Required | Allowed values and meaning |
| --- | --- | --- | --- |
| `state` | string of exactly two characters | Yes | US state or DC code, for example `TX`. Case-insensitive. |

The result is roughly 4 KB of JSON:

| Field | Meaning |
| --- | --- |
| `state_code`, `title`, `slug` | Identify the guide. |
| `rules` | Rule summary with statute citations. |
| `deadline_rows` | The guide's deadline table. |
| `faqs` | Common questions. |
| `source_url` | The guide's web page: `https://liendeadline.com/state-lien-guides/<slug>`. |
| `note` | A reminder that the guide is a reference, not a calculation. |
| `disclaimer` | Not legal advice. |

`rules`, `deadline_rows` and `faqs` are `null` when the API has no value for them. An unknown
state code returns an error: `LienDeadline API returned 404. No guide exists for that state code.`

### `list_state_lien_guides`

Lists every published state guide in one response, without pagination. Takes no parameters.
Public and read-only.

The result has `count` and `guides`, a list of `state_code`, `title` and `slug` for all 50 states
and DC, in alphabetical order by state name. It lists editorial guides only, and doesn't show
which states have calculated deadlines.

### Guides are not calculations

Guides are editorial summaries, and their day counts are not computed deadlines. Take filing
dates only from a verified `calculated` outcome of `calculate_supplier_deadlines` or
`calculate_supplier_deadlines_v3`. A missing deadline, an unresolved outcome or a raw candidate
needs qualified review.

## Customer tools

These two tools run only in the local npm package, with a LienDeadline customer API key in
`LIENDEADLINE_API_KEY`. The hosted endpoint doesn't register them. [CUSTOMER-API.md](CUSTOMER-API.md)
covers getting a key, configuring it and how it is sent.

Without a key, or with a malformed one, each tool returns a configuration error and makes no
request. There is no anonymous fallback. The invoice calculation is a separate contract: it
doesn't add states to the supplier calculation.

### `calculate_lien_deadline`

Calculates the preliminary notice and lien filing deadlines for one construction invoice from its
invoice or delivery date and state. The key needs the `deadline:calculate` scope.

| Name | Type | Required | Allowed values and meaning |
| --- | --- | --- | --- |
| `state` | string of exactly two characters | Yes | US state code, for example `TX`, `CA` or `DC`, from the jurisdictions the customer API supports. |
| `invoice_date` | string, `YYYY-MM-DD` | Yes | Invoice or delivery date. Deadlines count from it. |
| `project_type` | string | No | Usually `Commercial` or `Residential`. Changes the deadline in some states. |
| `notice_date` | string, `YYYY-MM-DD` | No | Date a preliminary notice was actually sent, if one was. |
| `role` | string | No | Your role on the project, for example `supplier`, `contractor` or `subcontractor`. |

The result has `state`, `invoice_date`, `project_type`, `preliminary_notice_deadline`,
`lien_deadline`, `waiver_due_date`, `prelim_deadline_days`, `lien_deadline_days`, `warnings`
(such as weekend or holiday rollover), `notes` and `disclaimer`. A date, day count or project
type that the API doesn't return is `null`. Missing `warnings` is `[]`, and missing `notes` is
`""`.

### `list_supported_states`

Returns `count` and `states`: the two-letter codes that `calculate_lien_deadline` accepts. Takes
no parameters. The key needs the `states:read` scope. The list doesn't cover editorial guides or
the states with calculated supplier deadlines.

## Statuses at a glance

| Status | Where it appears | Date | `required` in v3 | Meaning |
| --- | --- | --- | --- | --- |
| `calculated` | v2 and v3, overall and per outcome | On the outcome only | `true` | A verified deadline. |
| `review_required` | v2 and v3, overall and per outcome; v3 `scope_status` | No statutory date; v3 may return an explicit `action_by` planning target | `null` | Qualified review is needed. A fact is missing or `unknown`, or the case is outside calculated coverage. A valid result, not an error. |
| `awaiting_final_delivery` | v2 per outcome; v3 overall and per outcome | No | `true` | Deliveries are ongoing, and the lien date depends on the final delivery. |
| `not_required` | v2 and v3, per outcome | No | `false` | This notice or filing isn't required for these facts. |
| `no_lien_right` | v3 overall and per outcome, always on both outcomes; v3 `scope_status` | No | `false` | The supplier has no lien right in this scope. Not the same as `not_required`. |
| `supported` | v3 `scope_status` only | Not applicable | Not applicable | Discovery supports this scope. |

In v2 the overall status is only `calculated` or `review_required`. The v3 overall status follows
the order in [outcome statuses](#outcome-statuses). In both, read each outcome's own status before
you use a date.

## Response trimming

Some API responses carry content an agent can't use. The server trims them before returning.

| Tool | What the API returns | What the tool returns |
| --- | --- | --- |
| `get_state_lien_guide` | About 16 KB per guide, of which about 7 KB is rendered HTML | Only the structured fields, which carry the statute citations: about 4,300 characters |
| `list_state_lien_guides` | The guide index | `state_code`, `title` and `slug` for each guide, plus `count` |
| `calculate_lien_deadline` | The same object three times: under `data`, under `result` and flattened at the top level | One copy with only the fields listed above, plus `disclaimer` |
| `list_supported_states` | The jurisdiction list | `count` and `states` |

The supplier tools aren't trimmed. After verification, they return the API's result unchanged.

## Errors

A failed call doesn't stop the server. It returns `isError: true` and one plain-text message. A
`review_required` result is not an error. Messages never include the API's response body,
network error details or the customer key.

### Messages

| Message starts with | Cause |
| --- | --- |
| `MCP error -32602: Input validation error: Invalid arguments for tool <name>:` | An argument fails the tool's schema: a wrong type, a value outside the allowed list, a bad date pattern, `null`, or an undeclared field inside a strict object. |
| `Invalid supplier request:` | `calculate_supplier_deadlines` facts are invalid or contradictory. The message lists every problem by field. |
| `Invalid supplier scope:` | `get_supplier_questions` got a state, project type or hiring relationship it doesn't recognize. |
| `Invalid supplier-events-v3 request:` | `calculate_supplier_deadlines_v3` failed a local check: identity format, event ID, a date on an answer other than `yes` or on `homestead`, an impossible date, a final furnishing date before the first, or more than 64 events. |
| `Set LIENDEADLINE_API_KEY` or `LIENDEADLINE_API_KEY must be a dedicated customer key` | A customer tool has no key, or the key is malformed. |
| `Customer tools require LIENDEADLINE_API_URL=https://secure-api-v1.liendeadline.com` | A customer tool is configured for another origin. |
| `LIENDEADLINE_API_URL must be` | The configured API origin isn't a bare HTTP(S) origin. |
| `Could not reach the LienDeadline API.` | A network failure, a 20-second timeout or a redirect. Redirects are never followed. |
| `LienDeadline API returned <status>.` | The API answered with an error status. See the next table. |
| `LienDeadline API returned an invalid JSON response.` | The API's response wasn't JSON. |
| `LienDeadline API returned a result that does not match`, `Supplier discovery could not be verified` or `Supplier result does not match` | A supplier response failed verification. See [mismatches](#mismatches-are-errors-not-dates). |
| `MCP error -32602: Tool <name> not found` | The tool isn't registered. On the hosted endpoint, both customer tools return this. |

### API status codes

| Status | Hint the tool adds |
| --- | --- |
| 400, 422 | Depends on the tool. `calculate_supplier_deadlines`: check the fields against the `supplier-events-v2` schema. `get_supplier_questions`: check the project scope. `calculate_supplier_deadlines_v3`: check the discovered event fields and their date policies. `get_state_lien_guide` and `list_state_lien_guides`: check that `state` is a two-letter US state or DC code. `calculate_lien_deadline` and `list_supported_states`: check the state code and the date format. |
| 401 | Check that the customer key is active and unexpired. Replace a revoked or rotated key. |
| 403 | The customer key needs permission for this endpoint and its account. |
| 404 | No guide exists for that state code. |
| 409 | Supplier rules changed. Discover the questions again and reconfirm the facts. Don't reuse stale identities. |
| 429 | The API rate limit was reached. Retry later. |
| 503 | The service is unavailable and no deadline was calculated. For the v3 tools, this currently means the reviewed rules aren't released yet. |

### Mismatches are errors, not dates

The supplier tools check every API response against the request before they return it. A
response that fails a check is never shown as dates. The tool returns one of these errors
instead:

| Tool | Message |
| --- | --- |
| `calculate_supplier_deadlines` | `LienDeadline API returned a result that does not match the submitted supplier-events-v2 request; no dates are reported.` |
| `get_supplier_questions` | `Supplier discovery could not be verified for this scope; no questions or dates are reported.` |
| `calculate_supplier_deadlines_v3` | `Supplier result does not match the exact submitted facts and rule identities; no dates are reported.` |

The guide and customer tools don't run these checks.

Limits on the hosted endpoint, such as request size, rate and timeout, produce HTTP responses
rather than tool errors. See [HOSTED.md](HOSTED.md).

## Upstream requests

| Tool | Request to the LienDeadline API |
| --- | --- |
| `calculate_supplier_deadlines` | `POST /api/v1/supplier-deadlines` |
| `get_supplier_questions` | `GET /api/v1/supplier-deadlines/questions`, with the scope as query parameters |
| `calculate_supplier_deadlines_v3` | `POST /api/v1/supplier-deadlines/v3` |
| `get_state_lien_guide` | `GET /api/v1/state-guides/<STATE>` |
| `list_state_lien_guides` | `GET /api/v1/state-guides/index` |
| `calculate_lien_deadline` | `POST /api/v1/calculate-deadline`, with the customer key |
| `list_supported_states` | `GET /api/v1/supported-states`, with the customer key |

- The default origin is `https://secure-api-v1.liendeadline.com`.
- `LIENDEADLINE_API_URL` can point the public tools at another origin. It must be a bare HTTP(S)
  origin, without credentials, a path, a query or a fragment.
- The customer tools refuse every origin except `https://secure-api-v1.liendeadline.com`,
  including staging, other ports and plain HTTP. They send the key only there, in an
  `Authorization: Bearer` header.
- The public tools never send credentials.
- Requests never follow redirects, and they time out after 20 seconds.

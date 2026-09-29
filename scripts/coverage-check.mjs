// Live gate for coverage wording: runs the reported scenario from
// LienDeadline/liendeadline-website#398 for every jurisdiction through this server's own
// client (request validation and exact-echo verification) and fails unless every one returns
// calculated dates. Usage: npm run coverage
import { DEFAULT_BASE_URL, calculateSupplierDeadlines } from "../src/api.ts";

const STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO " +
  "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" ");
const scenario = {
  project_type: "commercial", hired_by: "contractor", first_delivery_date: "2026-06-01",
  last_delivery_date: "2026-08-14", deliveries_complete: true, special_events_reviewed: true,
};
const base = process.env.LIENDEADLINE_API_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL;

const results = [];
for (let i = 0; i < STATES.length; i += 5) {
  // Small batches keep the check well inside the public endpoint's rate limits.
  results.push(...await Promise.all(STATES.slice(i, i + 5).map(async (state) => {
    try {
      const r = await calculateSupplierDeadlines(base, { state, ...scenario });
      return { state, status: r.status, notice: r.preliminary_notice.status, lien: r.lien_filing.status };
    } catch (error) {
      return { state, status: "error", notice: "-", lien: String(error.message).slice(0, 80) };
    }
  })));
}

const missing = results.filter((r) => r.status !== "calculated");
console.log(`${results.length - missing.length}/${results.length} jurisdictions calculated`);
for (const r of missing) console.log(`  ${r.state}: ${r.status} (notice ${r.notice}, lien ${r.lien})`);
process.exit(missing.length === 0 ? 0 : 1);

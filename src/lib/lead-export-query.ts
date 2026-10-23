import type { SupabaseClient } from "@supabase/supabase-js";
import { EXCLUDED_CALLER_CLASSES } from "@/lib/caller-class";
import {
  ExportInputError,
  closedStatusList,
  exportColumns,
  exportWindow,
  nonLeadFilter,
  type ExportLead,
  type ExportQuery,
} from "@/lib/lead-export";
import { isPracticeTestPhone } from "@/lib/test-phone";

const PAGE = 1000;
const MAX_ROWS = 20000;

type LeadQuery = {
  gte(column: string, value: string): LeadQuery;
  lt(column: string, value: string): LeadQuery;
  eq(column: string, value: string | boolean): LeadQuery;
  is(column: string, value: null): LeadQuery;
  in(column: string, values: readonly string[]): LeadQuery;
  not(column: string, operator: string, value: string): LeadQuery;
  or(filters: string): LeadQuery;
  order(column: string, options: { ascending: boolean }): LeadQuery;
  range(from: number, to: number): PromiseLike<{ data: ExportLead[] | null; error: { message: string } | null }>;
};

export async function loadExportLeads(supabase: SupabaseClient, query: ExportQuery): Promise<ExportLead[]> {
  const rows: ExportLead[] = [];
  let fetched = 0;
  for (;;) {
    const request = applyFilters(supabase.from("leads").select(exportColumns(query.fields)) as unknown as LeadQuery, query)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(fetched, fetched + PAGE - 1);
    const { data, error } = await request;
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    fetched += batch.length;
    for (const row of batch) {
      if (!query.includeTest && isPracticeTestPhone(row.phone_e164 || row.phone)) continue;
      rows.push(row);
    }
    if (batch.length < PAGE) return rows;
    if (fetched >= MAX_ROWS) {
      throw new ExportInputError("That export is larger than 20,000 leads. Narrow the time frame or the lead type and try again.");
    }
  }
}

function applyFilters(request: LeadQuery, query: ExportQuery): LeadQuery {
  const window = exportWindow(query);
  if (window) request = request.gte("created_at", window.start).lt("created_at", window.end);
  if (query.set === "leads") request = request.or(`caller_class.is.null,caller_class.not.in.(${nonLeadFilter()})`);
  if (query.set === "nonleads") request = request.in("caller_class", EXCLUDED_CALLER_CLASSES);
  if (query.status === "open") request = request.not("lead_status", "in", closedStatusList());
  else if (query.status === "closed") request = request.in("lead_status", ["Signed", "Promoted", "Lost", "Referred"]);
  else if (query.status !== "all") request = request.eq("lead_status", query.status);
  if (query.caseTypes.length) request = request.in("case_type", query.caseTypes);
  if (query.sourceTypes.length) request = request.in("source_type", query.sourceTypes);
  request = applyChoice(request, "qualified", query.qualified);
  request = applyChoice(request, "desired_case", query.desired);
  if (query.signed === "yes") request = request.eq("signed_case", true);
  if (query.signed === "no") request = request.eq("signed_case", false);
  if (!query.includeMarkedTest) request = request.eq("test", false);
  if (query.owner === "__none__") request = request.is("owner_name", null);
  else if (query.owner) request = request.eq("owner_name", query.owner);
  return request;
}

function applyChoice(request: LeadQuery, column: string, choice: ExportQuery["qualified"]): LeadQuery {
  if (choice === "yes") return request.eq(column, true);
  if (choice === "no") return request.eq(column, false);
  if (choice === "unset") return request.is(column, null);
  return request;
}

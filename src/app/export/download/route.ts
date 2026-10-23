import { ExportInputError, exportFilename, leadsToCsv, parseExportForm } from "@/lib/lead-export";
import { loadExportLeads } from "@/lib/lead-export-query";
import { requireAdmin } from "@/lib/session";

export async function POST(request: Request) {
  const { supabase } = await requireAdmin();
  const form = await request.formData();
  try {
    const query = parseExportForm(form);
    const rows = await loadExportLeads(supabase, query);
    const csv = leadsToCsv(rows, query.fields);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not export the leads.";
    const status = err instanceof ExportInputError ? 400 : 500;
    return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

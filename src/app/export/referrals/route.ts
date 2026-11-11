import { ExportInputError } from "@/lib/lead-export";
import { loadReferralExport, referralExportFilename, referralsToCsv } from "@/lib/referral-export";
import { requireAdmin } from "@/lib/session";

export async function POST() {
  const { supabase } = await requireAdmin();
  try {
    const rows = await loadReferralExport(supabase);
    const csv = referralsToCsv(rows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${referralExportFilename()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not export the referrals.";
    const status = err instanceof ExportInputError ? 400 : 500;
    return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

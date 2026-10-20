import { DashboardReport } from "@/components/DashboardReport";
import { loadDashboardReport, loadNavTiles, resolvePeriod } from "@/lib/dashboard";
import { requireStaff } from "@/lib/session";

export const metadata = { title: "Intake · Intake Manager" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const period = resolvePeriod(params);
  const { supabase } = await requireStaff();
  const [tiles, report] = await Promise.all([loadNavTiles(supabase), loadDashboardReport(supabase, period)]);

  return <DashboardReport period={period} tiles={tiles} rates={report.rates} counts={report.counts} />;
}

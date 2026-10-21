"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QueueFilter } from "@/components/WorkQueue";

type FilterKey = "grade" | "priority" | "screen" | "intake";

export function WorkListFilters({
  gradeOptions,
  priorityOptions,
  screenOptions,
  intakeOptions,
}: {
  gradeOptions: string[];
  priorityOptions: string[];
  screenOptions: string[];
  intakeOptions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const grade = params.get("grade") ?? "";
  const priority = params.get("priority") ?? "";
  const screen = params.get("screen") ?? "";
  const intake = params.get("intake") ?? "";

  function setFilter(key: FilterKey, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <>
      <QueueFilter label="Case grade" value={grade} options={gradeOptions} onChange={(value) => setFilter("grade", value)} />
      <QueueFilter label="Priority" value={priority} options={priorityOptions} onChange={(value) => setFilter("priority", value)} />
      <QueueFilter label="Screened by" value={screen} options={screenOptions} onChange={(value) => setFilter("screen", value)} />
      <QueueFilter label="Intake by" value={intake} options={intakeOptions} onChange={(value) => setFilter("intake", value)} />
    </>
  );
}

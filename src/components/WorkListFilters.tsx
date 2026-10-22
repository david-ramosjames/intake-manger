"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QueueFilter } from "@/components/WorkQueue";

type FilterKey = "grade" | "priority" | "screen" | "intake" | "sourceType" | "leadSource";

export function WorkListFilters({
  gradeOptions,
  priorityOptions,
  screenOptions,
  intakeOptions,
  sourceTypeOptions,
  leadSourceOptions,
  onFilterChange,
}: {
  gradeOptions: string[];
  priorityOptions: string[];
  screenOptions: string[];
  intakeOptions: string[];
  sourceTypeOptions: string[];
  leadSourceOptions: string[];
  onFilterChange?: (filters: { grade: string; priority: string; screen: string; intake: string; sourceType: string; leadSource: string }) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  
  const [optimisticGrade, setOptimisticGrade] = useState(params.get("grade") ?? "");
  const [optimisticPriority, setOptimisticPriority] = useState(params.get("priority") ?? "");
  const [optimisticScreen, setOptimisticScreen] = useState(params.get("screen") ?? "");
  const [optimisticIntake, setOptimisticIntake] = useState(params.get("intake") ?? "");
  const [optimisticSourceType, setOptimisticSourceType] = useState(params.get("sourceType") ?? "");
  const [optimisticLeadSource, setOptimisticLeadSource] = useState(params.get("leadSource") ?? "");

  function setFilter(key: FilterKey, value: string) {
    const newFilters = {
      grade: key === "grade" ? value : optimisticGrade,
      priority: key === "priority" ? value : optimisticPriority,
      screen: key === "screen" ? value : optimisticScreen,
      intake: key === "intake" ? value : optimisticIntake,
      sourceType: key === "sourceType" ? value : optimisticSourceType,
      leadSource: key === "leadSource" ? value : optimisticLeadSource,
    };

    if (key === "grade") setOptimisticGrade(value);
    if (key === "priority") setOptimisticPriority(value);
    if (key === "screen") setOptimisticScreen(value);
    if (key === "intake") setOptimisticIntake(value);
    if (key === "sourceType") setOptimisticSourceType(value);
    if (key === "leadSource") setOptimisticLeadSource(value);

    if (onFilterChange) {
      onFilterChange(newFilters);
    }

    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    
    window.history.replaceState({}, "", url);
    
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  }

  return (
    <>
      <QueueFilter label="Case grade" value={optimisticGrade} options={gradeOptions} onChange={(value) => setFilter("grade", value)} pending={isPending} />
      <QueueFilter label="Priority" value={optimisticPriority} options={priorityOptions} onChange={(value) => setFilter("priority", value)} pending={isPending} />
      <QueueFilter label="Source type" value={optimisticSourceType} options={sourceTypeOptions} onChange={(value) => setFilter("sourceType", value)} pending={isPending} />
      <QueueFilter label="Lead source" value={optimisticLeadSource} options={leadSourceOptions} onChange={(value) => setFilter("leadSource", value)} pending={isPending} />
      <QueueFilter label="Screened by" value={optimisticScreen} options={screenOptions} onChange={(value) => setFilter("screen", value)} pending={isPending} />
      <QueueFilter label="Intake by" value={optimisticIntake} options={intakeOptions} onChange={(value) => setFilter("intake", value)} pending={isPending} />
    </>
  );
}

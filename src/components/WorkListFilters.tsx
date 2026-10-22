"use client";

import { inArrivedRange, useWorkFilters, type WorkFilterKey } from "@/components/WorkFilters";
import { QueueFilter, type QueueRow } from "@/components/WorkQueue";
import { matchesQueue } from "@/lib/queue";
import { workGradeOptions, workHandlerOptions, workLeadSourceOptions, workPriorityOptions, workSourceTypeOptions } from "@/lib/work-queue-options";

export function WorkListFilters({ rows }: { rows: QueueRow[] }) {
  const { values, setValue } = useWorkFilters();
  const optionRows = rows.filter(
    (row) => inArrivedRange(row.age, values.range) && matchesQueue(values.queue, row.cycle, row.attention) && (!values.entry || row.entry === values.entry),
  );
  const gradeOptions = workGradeOptions(optionRows);
  const priorityOptions = workPriorityOptions(optionRows);
  const screenOptions = workHandlerOptions(optionRows, "screen");
  const intakeOptions = workHandlerOptions(optionRows, "intake");
  const sourceTypeOptions = workSourceTypeOptions(optionRows);
  const leadSourceOptions = workLeadSourceOptions(optionRows);

  function setFilter(key: Exclude<WorkFilterKey, "q">, value: string) {
    setValue(key, value);
  }

  return (
    <>
      <QueueFilter label="Case grade" value={values.grade} options={gradeOptions} onChange={(value) => setFilter("grade", value)} />
      <QueueFilter label="Priority" value={values.priority} options={priorityOptions} onChange={(value) => setFilter("priority", value)} />
      <QueueFilter label="Source type" value={values.sourceType} options={sourceTypeOptions} onChange={(value) => setFilter("sourceType", value)} />
      <QueueFilter label="Lead source" value={values.leadSource} options={leadSourceOptions} onChange={(value) => setFilter("leadSource", value)} />
      <QueueFilter label="Screened by" value={values.screen} options={screenOptions} onChange={(value) => setFilter("screen", value)} />
      <QueueFilter label="Intake by" value={values.intake} options={intakeOptions} onChange={(value) => setFilter("intake", value)} />
    </>
  );
}

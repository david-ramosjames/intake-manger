/** Shared filter option helpers — safe to import from server and client. */

export type WorkFilterRow = {
  grade: string | null;
  priority: string | null;
  screenBy: string | null;
  intakeBy: string | null;
  sourceType: string;
  leadSource: string;
};

function gradeLabel(row: WorkFilterRow): string {
  return row.grade?.trim() || "Not set";
}

function priorityLabel(row: WorkFilterRow): string {
  return row.priority ?? "None";
}

function screenByLabel(row: WorkFilterRow): string {
  return row.screenBy?.trim() || "Not set";
}

function intakeByLabel(row: WorkFilterRow): string {
  return row.intakeBy?.trim() || "Not set";
}

export function workGradeOptions(rows: WorkFilterRow[]): string[] {
  return [...new Set(rows.map(gradeLabel))].sort((left, right) =>
    left === "Not set" ? 1 : right === "Not set" ? -1 : left.localeCompare(right),
  );
}

export function workPriorityOptions(rows: WorkFilterRow[]): string[] {
  const priorityOrder = ["Flagged", "Suggested", "Contract out", "None"];
  return [...new Set(rows.map(priorityLabel))].sort((left, right) => {
    const leftPlace = priorityOrder.indexOf(left);
    const rightPlace = priorityOrder.indexOf(right);
    return (leftPlace === -1 ? 99 : leftPlace) - (rightPlace === -1 ? 99 : rightPlace) || left.localeCompare(right);
  });
}

export function workHandlerOptions(rows: WorkFilterRow[], kind: "screen" | "intake"): string[] {
  const labels = rows.map((row) => (kind === "screen" ? screenByLabel(row) : intakeByLabel(row)));
  return [...new Set(labels)].sort((left, right) =>
    left === "Not set" ? 1 : right === "Not set" ? -1 : left.localeCompare(right),
  );
}

function sourceTypeLabel(row: WorkFilterRow): string {
  return row.sourceType?.trim() || "Not set";
}

function leadSourceLabel(row: WorkFilterRow): string {
  return row.leadSource?.trim() || "Not set";
}

export function workSourceTypeOptions(rows: WorkFilterRow[]): string[] {
  return [...new Set(rows.map(sourceTypeLabel))].sort((left, right) =>
    left === "Not set" ? 1 : right === "Not set" ? -1 : left.localeCompare(right),
  );
}

export function workLeadSourceOptions(rows: WorkFilterRow[]): string[] {
  return [...new Set(rows.map(leadSourceLabel))].sort((left, right) =>
    left === "Not set" ? 1 : right === "Not set" ? -1 : left.localeCompare(right),
  );
}

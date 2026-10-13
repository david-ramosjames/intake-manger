/** A consultation is a phone call Quo Router marked as the consultation. Desired is unanswered until that date exists. */
export function desiredCase(input: {
  consultationDate: string | null;
  grade: string | null;
  tags: string[];
  declineReason: string | null;
  closeReason: string | null;
  leadStatus: string | null;
  signed: boolean;
  qualified: boolean | null;
}): boolean | null {
  if (!input.consultationDate) return null;
  const declined = Boolean(input.declineReason) || input.tags.some((tag) => tag.startsWith("DEC:"));
  const qualifiedNo = input.tags.includes("QUALIFIED NO") || input.qualified === false;
  const qualifiedYes = input.tags.includes("QUALIFIED YES") || input.qualified === true;
  const notALead = input.closeReason === "not_a_lead" || input.leadStatus === "Lost";
  const grade = (input.grade || "").toUpperCase();
  if (notALead || declined || qualifiedNo || grade === "C") return false;
  if (input.signed || qualifiedYes || grade === "A" || grade === "B") return true;
  return null;
}

export function consultationWhen(value: string | null | undefined): string {
  if (!value) return "No consult";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "No consult";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export function desiredWord(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

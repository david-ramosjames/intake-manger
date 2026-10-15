/** US-leaning E.164. Returns null when the digits are not a US 10- or 11-digit number. */
export function toE164(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Digits only, so (806) 663-9915 and +1 806-663-9915 search the same number. */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Last 10 digits when the value has a full number, otherwise whatever digits were typed. */
export function phoneTail(value: string | null | undefined): string {
  const digits = phoneDigits(value);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * A like pattern that ignores spaces and punctuation.
 * 8066639915 matches (806) 663-9915, and 6639915 matches the end of that number.
 */
export function phoneLikePattern(value: string | null | undefined): string | null {
  const tail = phoneTail(value);
  if (tail.length < 7) return null;
  if (tail.length >= 10) return `${tail.slice(0, 3)}%${tail.slice(3, 6)}%${tail.slice(6)}`;
  return `${tail.slice(0, tail.length - 4)}%${tail.slice(-4)}`;
}

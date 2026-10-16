import { phoneTail } from "./phone";

/** David's handset. A signed test contract must not block SMS sequences or Slack call reminders. */
const PRACTICE_TEST_TAILS = new Set(["7654183805"]);

export function isPracticeTestPhone(phone: string | null | undefined): boolean {
  return PRACTICE_TEST_TAILS.has(phoneTail(phone));
}

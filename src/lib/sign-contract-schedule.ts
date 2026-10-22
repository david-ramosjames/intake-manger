/**
 * Sign-contract reminder schedule configuration
 * 
 * NOTE: This is a synced copy of the default schedule from the sign-flow service.
 * Source: https://github.com/david-ramosjames/sign-flow/blob/main/src/lib/reminder-schedule.ts
 * 
 * The actual schedule can be customized per-firm in sign-flow's app_settings (Firestore).
 * This file documents the default behavior for the timeline view.
 * 
 * TO KEEP IN SYNC:
 * - If the default schedule changes in sign-flow, update this file
 * - OR set up an API endpoint in sign-flow to expose the schedule
 * - OR migrate sign-flow's app_settings to Supabase for direct queries
 */

export type SignContractReminderStep = {
  day: number;
  hour: number;
  minutesAfterSend?: number;
  label: string;
};

/**
 * Default reminder schedule for contract signing
 * Default: Day 0 (+30 minutes), then Days 1, 2, 3, 5, 7 at 9 AM local time
 */
export const DEFAULT_SIGN_CONTRACT_STEPS: SignContractReminderStep[] = [
  { day: 0, hour: 9, minutesAfterSend: 30, label: "Initial reminder (30 min after send)" },
  { day: 1, hour: 9, label: "Day 1 reminder" },
  { day: 2, hour: 9, label: "Day 2 reminder" },
  { day: 3, hour: 9, label: "Day 3 reminder" },
  { day: 5, hour: 9, label: "Day 5 reminder" },
  { day: 7, hour: 9, label: "Day 7 reminder" },
];

/**
 * Convert a sign-contract step to delay in minutes from Day 0
 */
export function signContractStepToDelayMinutes(step: SignContractReminderStep): number {
  if (step.day === 0 && step.minutesAfterSend !== undefined) {
    return step.minutesAfterSend;
  }
  return step.day * 24 * 60 + step.hour * 60;
}

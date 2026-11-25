/** Who screened and who did the intake, from the people actually on the calls. */

export type HandlerLeg = {
  at: number;
  name: string;
  seconds: number;
};

const INTAKE_FIRST = /^(andrea|roman|valeria|claudia|liz)\b/i;

export function isSharedSeat(name: string | null | undefined): boolean {
  const value = String(name || "").replace(/\s+/g, " ").trim();
  if (!value) return false;
  return /^(legal assistant|paralegal(?:\s*\d+)?|intake specialist|attorney(?:\s*\d+)?|executive assistant)$/i.test(value)
    || /ramos james executive assistant/i.test(value);
}

export function isIntakeRoster(name: string | null | undefined): boolean {
  return INTAKE_FIRST.test(String(name || "").trim());
}

/**
 * Screener is whoever answered or placed the call first.
 * A later person on the intake roster (Andrea, Roman, Valeria, Claudia, Liz) did the intake.
 * One person the whole time is also the intake once the lead is a consult or qualified.
 * When that is still unclear, the person who was on the phone much longer is the intake.
 */
export function handlersFromLegs(
  legs: HandlerLeg[],
  needsIntake: boolean,
): { screen: string | null; intake: string | null } {
  const ordered = legs.filter((leg) => leg.name && leg.at).sort((a, b) => a.at - b.at);
  if (!ordered.length) return { screen: null, intake: null };
  const screen = ordered[0].name;
  const seconds = new Map<string, number>();
  for (const leg of ordered) seconds.set(leg.name, (seconds.get(leg.name) || 0) + Math.max(0, leg.seconds));
  const names = [...seconds.keys()];
  if (names.length === 1) return { screen, intake: needsIntake ? screen : null };

  const received = [...ordered].reverse().find((leg) => leg.name !== screen && isIntakeRoster(leg.name));
  if (received) return { screen, intake: received.name };

  if (!needsIntake) return { screen, intake: null };
  const ranked = [...names].sort((a, b) => (seconds.get(b) || 0) - (seconds.get(a) || 0));
  const longer = ranked[0];
  const longSeconds = seconds.get(longer) || 0;
  const nextSeconds = seconds.get(ranked[1]) || 0;
  if (longSeconds >= 8 * 60 && longSeconds >= nextSeconds * 2) return { screen, intake: longer };
  return { screen, intake: null };
}

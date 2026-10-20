import { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Same inbox rules as the Quo reporter Call Stats email.
 * Lines in EXCLUDE are dropped entirely. Incoming calls on IGNORE_INCOMING
 * stay out of the answer-rate total. Transfer lines are empty, so RJL Transfers
 * inbound counts, matching the email.
 */
export const STATS_EXCLUDE_INBOXES = ["Extra Number", "SA Law Firm", "Trucking Chicas"];
export const STATS_IGNORE_INCOMING = ["RJL Outbound"];

export const ANSWER_RATE_INBOXES = ["Leads", "RJL Main Line", "RGV Number", "RJL Transfers", "Intake"];

const QUO_BASE = (process.env.QUO_API_BASE || "https://api.quo.com/v1").replace(/\/$/, "");
const SYNC_ID = "default";
const LEDGER_SYNC_ID = "ledger";

type Line = { id: string; name: string; number: string };

type InboxCall = {
  id: string;
  call_id: string;
  line_name: string;
  direction: string;
  status: string;
  answered_by: string | null;
  ai_handled: boolean;
  created_at: string;
};

type SyncState = {
  window_start: string | null;
  request_token: string | null;
  pair_index: number;
  finished_at: string | null;
};

export type AnswerRate = {
  answered: number;
  incoming: number;
  lines: string[];
  earliest: string | null;
};

function lowerSet(names: string[]) {
  return new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
}

const EXCLUDE = lowerSet(STATS_EXCLUDE_INBOXES);
const IGNORE_INCOMING = lowerSet(STATS_IGNORE_INCOMING);

function last10(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function samePhone(a: string, b: string) {
  const left = last10(a);
  const right = last10(b);
  return Boolean(left) && left.length >= 10 && left === right;
}

function participantPhone(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const row = value as { phoneNumber?: string; number?: string; e164?: string };
    return row.phoneNumber || row.number || row.e164 || "";
  }
  return "";
}

function actorId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object") {
    const row = value as { id?: string; userId?: string };
    return row.id || row.userId || null;
  }
  return String(value);
}

function incoming(direction: string) {
  const value = direction.toLowerCase();
  return value === "incoming" || value === "inbound";
}

export function tallyAnswerRate(rows: Array<Pick<InboxCall, "line_name" | "direction" | "status" | "answered_by" | "ai_handled">>): {
  answered: number;
  incoming: number;
  lines: string[];
} {
  let answered = 0;
  let total = 0;
  const lines = new Set<string>();
  for (const row of rows) {
    if (!incoming(row.direction)) continue;
    const line = row.line_name.trim();
    const key = line.toLowerCase();
    if (!line || EXCLUDE.has(key) || IGNORE_INCOMING.has(key)) continue;
    lines.add(line);
    total += 1;
    const status = row.status.toLowerCase();
    if (row.ai_handled) continue;
    if ((status === "completed" || status === "answered") && row.answered_by) answered += 1;
  }
  return { answered, incoming: total, lines: [...lines].sort() };
}

async function quoJson(apiKey: string, path: string, params: Record<string, string | string[]>) {
  const url = new URL(`${QUO_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value) url.searchParams.set(key, value);
  }
  let last = "Quo request failed";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { Authorization: apiKey }, cache: "no-store" });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as { data?: unknown; nextPageToken?: string; message?: string }) : {};
    if (response.ok) return body;
    last = body.message || `Quo returned ${response.status}`;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw new Error(last);
}

async function listLines(apiKey: string): Promise<Line[]> {
  const body = await quoJson(apiKey, "/phone-numbers", {});
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows
    .map((item) => {
      const row = item as { id?: string; name?: string; number?: string; formattedNumber?: string };
      if (!row.id) return null;
      return { id: row.id, name: (row.name || "").trim() || "Quo number", number: row.number || row.formattedNumber || "" };
    })
    .filter((line): line is Line => Boolean(line));
}

async function loadKey(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("intake_settings").select("quo_api_key").eq("id", "default").maybeSingle();
  const stored = typeof data?.quo_api_key === "string" ? data.quo_api_key.trim() : "";
  return stored || process.env.QUO_API_KEY?.trim() || null;
}

function callRow(call: Record<string, unknown>, lineName: string): InboxCall | null {
  const callId = typeof call.id === "string" ? call.id : "";
  const phoneNumberId = typeof call.phoneNumberId === "string" ? call.phoneNumberId : "";
  const createdAt = typeof call.createdAt === "string" ? call.createdAt : typeof call.answeredAt === "string" ? call.answeredAt : "";
  if (!callId || !createdAt) return null;
  return {
    id: `${callId}::${phoneNumberId}`,
    call_id: callId,
    line_name: lineName,
    direction: typeof call.direction === "string" ? call.direction : "",
    status: typeof call.status === "string" ? call.status : "",
    answered_by: actorId(call.answeredBy),
    ai_handled: Boolean(call.aiHandled),
    created_at: createdAt,
  };
}

async function storeCalls(supabase: SupabaseClient, rows: InboxCall[], options?: { preserveAi?: boolean }) {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  if (!unique.length) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("quo_inbox_calls").upsert(
    unique.map((row) => {
      const item: Record<string, unknown> = { ...row, synced_at: now };
      if (!item.answered_by) delete item.answered_by;
      // The webhook ledger does not carry Quo's aiHandled flag. A false here
      // would wipe the person-vs-agent mark the list API already stored.
      if (options?.preserveAi && !item.ai_handled) delete item.ai_handled;
      return item;
    }),
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
}

async function callsForPair(apiKey: string, phoneNumberId: string, participant: string, fromIso: string, toIso: string) {
  const found: Record<string, unknown>[] = [];
  let pageToken = "";
  do {
    const body = await quoJson(apiKey, "/calls", {
      phoneNumberId,
      participants: [participant],
      maxResults: "100",
      createdAfter: fromIso,
      createdBefore: toIso,
      pageToken,
    });
    const batch = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
    found.push(...batch);
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return found;
}

type Pair = { phoneNumberId: string; participant: string };

async function conversationPage(apiKey: string, updatedAfter: string, pageToken: string) {
  const body = await quoJson(apiKey, "/conversations", {
    maxResults: "100",
    updatedAfter,
    pageToken,
  });
  const data = Array.isArray(body.data) ? (body.data as Array<{ phoneNumberId?: string; participants?: unknown[] }>) : [];
  return { data, nextPageToken: body.nextPageToken || "" };
}

function pairsOnPage(
  conversations: Array<{ phoneNumberId?: string; participants?: unknown[] }>,
  lines: Line[],
): Pair[] {
  const included = new Map(lines.filter((line) => !EXCLUDE.has(line.name.toLowerCase())).map((line) => [line.id, line]));
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  for (const conversation of conversations) {
    const line = conversation.phoneNumberId ? included.get(conversation.phoneNumberId) : undefined;
    if (!line) continue;
    const others = (conversation.participants || [])
      .map(participantPhone)
      .filter((phone) => phone && !samePhone(phone, line.number));
    for (const participant of [...new Set(others)]) {
      const key = `${line.id}|${participant}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ phoneNumberId: line.id, participant });
    }
  }
  return pairs;
}

async function readState(supabase: SupabaseClient): Promise<SyncState | null> {
  const { data, error } = await supabase
    .from("quo_inbox_sync")
    .select("window_start, request_token, pair_index, finished_at")
    .eq("id", SYNC_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    window_start: data.window_start,
    request_token: data.request_token,
    pair_index: data.pair_index ?? 0,
    finished_at: data.finished_at,
  };
}

async function writeState(supabase: SupabaseClient, state: SyncState, id = SYNC_ID) {
  const { error } = await supabase.from("quo_inbox_sync").upsert({ id, ...state, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

const OVERLAP_MS = 15 * 60 * 1000;

async function newestStoredCall(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("quo_inbox_calls")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.created_at ?? null;
}

/**
 * Add calls that are newer than the last saved cursor. Stored rows are the running total.
 * A finished cursor keeps `request_token` null and `window_start` at the time already covered.
 * While a pass is still paging, `request_token` is set and `finished_at` is the end of that pass.
 */
export async function syncInboxCalls(
  supabase: SupabaseClient,
  options?: { lookbackHours?: number; maxPairs?: number; restart?: boolean },
): Promise<{ stored: number; finished: boolean }> {
  const apiKey = await loadKey(supabase);
  if (!apiKey) return { stored: 0, finished: true };
  const maxPairs = options?.maxPairs ?? 80;
  const lines = await listLines(apiKey);
  const lineName = new Map(lines.map((line) => [line.id, line.name]));
  let state = await readState(supabase);
  const passing = Boolean(state && state.request_token != null && !options?.restart);
  if (!passing) {
    const covered = state?.request_token == null ? state?.window_start : null;
    let from = covered;
    if (!from) {
      const newest = await newestStoredCall(supabase);
      const lookback = options?.lookbackHours ?? 48;
      from = newest
        ? new Date(Date.parse(newest) - OVERLAP_MS).toISOString()
        : new Date(Date.now() - lookback * 60 * 60 * 1000).toISOString();
    } else {
      from = new Date(Date.parse(from) - OVERLAP_MS).toISOString();
    }
    state = {
      window_start: from,
      request_token: "",
      pair_index: 0,
      finished_at: new Date().toISOString(),
    };
  }
  if (!state?.window_start || state.request_token == null) return { stored: 0, finished: true };
  const from = state.window_start;
  const through = state.finished_at || new Date().toISOString();
  const page = await conversationPage(apiKey, from, state.request_token);
  const pairs = pairsOnPage(page.data, lines);
  const slice = pairs.slice(state.pair_index, state.pair_index + maxPairs);
  const rows: InboxCall[] = [];
  for (const pair of slice) {
    try {
      const calls = await callsForPair(apiKey, pair.phoneNumberId, pair.participant, from, through);
      for (const call of calls) {
        const name = lineName.get(typeof call.phoneNumberId === "string" ? call.phoneNumberId : pair.phoneNumberId) || "";
        if (!name || EXCLUDE.has(name.toLowerCase())) continue;
        const row = callRow(call, name);
        if (row && row.created_at >= from && row.created_at < through) rows.push(row);
      }
    } catch {
      // One conversation can fail without stopping the sweep.
    }
  }
  await storeCalls(supabase, rows);
  const nextIndex = state.pair_index + slice.length;
  if (nextIndex < pairs.length) {
    await writeState(supabase, { window_start: from, request_token: state.request_token, pair_index: nextIndex, finished_at: through });
    return { stored: rows.length, finished: false };
  }
  if (page.nextPageToken) {
    await writeState(supabase, { window_start: from, request_token: page.nextPageToken, pair_index: 0, finished_at: through });
    return { stored: rows.length, finished: false };
  }
  await writeState(supabase, {
    window_start: through,
    request_token: null,
    pair_index: 0,
    finished_at: new Date().toISOString(),
  });
  return { stored: rows.length, finished: true };
}

/** Walk every conversation updated in the window and store its calls. Used to fill history. */
export async function backfillInboxCalls(
  supabase: SupabaseClient,
  options: { fromIso: string; toIso: string; onProgress?: (done: number, stored: number) => void },
): Promise<{ stored: number; pairs: number }> {
  const apiKey = await loadKey(supabase);
  if (!apiKey) throw new Error("Quo API key is not set.");
  const lines = await listLines(apiKey);
  const lineName = new Map(lines.map((line) => [line.id, line.name]));
  let pageToken = "";
  let stored = 0;
  let pairsDone = 0;
  do {
    const page = await conversationPage(apiKey, options.fromIso, pageToken);
    const pairs = pairsOnPage(page.data, lines);
    const queue = [...pairs];
    const workers = Array.from({ length: 4 }, async () => {
      for (;;) {
        const pair = queue.shift();
        if (!pair) return;
        try {
          const calls = await callsForPair(apiKey, pair.phoneNumberId, pair.participant, options.fromIso, options.toIso);
          const rows: InboxCall[] = [];
          for (const call of calls) {
            const id = typeof call.phoneNumberId === "string" ? call.phoneNumberId : pair.phoneNumberId;
            const name = lineName.get(id) || "";
            if (!name || EXCLUDE.has(name.toLowerCase())) continue;
            const row = callRow(call, name);
            if (row && row.created_at >= options.fromIso && row.created_at < options.toIso) rows.push(row);
          }
          await storeCalls(supabase, rows);
          stored += rows.length;
        } catch {
          // Keep going. A later sweep can pick the conversation up.
        }
        pairsDone += 1;
        if (pairsDone % 40 === 0) options.onProgress?.(pairsDone, stored);
      }
    });
    await Promise.all(workers);
    pageToken = page.nextPageToken;
  } while (pageToken);
  options.onProgress?.(pairsDone, stored);
  return { stored, pairs: pairsDone };
}

export async function loadInboxAnswerRate(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
): Promise<AnswerRate> {
  const rows: InboxCall[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("quo_inbox_calls")
      .select("line_name, direction, status, answered_by, ai_handled, created_at")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as InboxCall[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  const tally = tallyAnswerRate(rows);
  const { data: earliestRow } = await supabase
    .from("quo_inbox_calls")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { ...tally, earliest: earliestRow?.created_at ?? null };
}

type LedgerCall = {
  call_id: string;
  phone_number_id: string | null;
  direction: string | null;
  status: string | null;
  answered_by: string | null;
  ai_handled: boolean | null;
  created_at: Date | string | null;
  line_name: string | null;
  updated_at: Date | string | null;
};

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/**
 * Copy the reporter webhook ledger into the dashboard call table.
 * The email counts these rows. The Quo list API leaves out auto-forward and transfer legs.
 */
export async function syncCallLedger(supabase: SupabaseClient): Promise<{ stored: number; connected: boolean; finished: boolean }> {
  const connectionString = process.env.REPORTING_DATABASE_URL?.trim();
  if (!connectionString) return { stored: 0, connected: false, finished: true };
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  try {
    const apiKey = await loadKey(supabase);
    const lineName = new Map<string, string>();
    if (apiKey) {
      for (const line of await listLines(apiKey)) lineName.set(line.id, line.name);
    }
    const state = await readStateRow(supabase, LEDGER_SYNC_ID);
    const since = state?.window_start || "2026-01-01T00:00:00.000Z";
    const afterId = state?.request_token || "";
    const { rows } = await pool.query<LedgerCall>(
      `SELECT call_id, phone_number_id, direction, status, answered_by, ai_handled, created_at, line_name, updated_at
       FROM quo_calls
       WHERE COALESCE(updated_at, created_at) > $1
          OR (COALESCE(updated_at, created_at) = $1 AND call_id > $2)
       ORDER BY COALESCE(updated_at, created_at) ASC, call_id ASC
       LIMIT 1000`,
      [since, afterId],
    );
    const calls: InboxCall[] = [];
    for (const row of rows) {
      const createdAt = iso(row.created_at);
      if (!row.call_id || !createdAt) continue;
      const phoneNumberId = row.phone_number_id || "";
      const name = (row.line_name || "").trim() || lineName.get(phoneNumberId) || "";
      if (!name || EXCLUDE.has(name.toLowerCase())) continue;
      calls.push({
        id: `${row.call_id}::${phoneNumberId}`,
        call_id: row.call_id,
        line_name: name,
        direction: row.direction || "",
        status: (row.status || "").toLowerCase(),
        answered_by: row.answered_by,
        ai_handled: Boolean(row.ai_handled) || (row.status || "").toLowerCase().includes("ai"),
        created_at: createdAt,
      });
    }
    await storeCalls(supabase, calls, { preserveAi: true });
    const last = rows[rows.length - 1];
    if (last) {
      await writeState(
        supabase,
        {
          window_start: iso(last.updated_at) || iso(last.created_at) || since,
          request_token: last.call_id,
          pair_index: 0,
          finished_at: new Date().toISOString(),
        },
        LEDGER_SYNC_ID,
      );
    }
    return { stored: calls.length, connected: true, finished: rows.length < 1000 };
  } finally {
    await pool.end();
  }
}

async function readStateRow(supabase: SupabaseClient, id: string): Promise<SyncState | null> {
  const { data, error } = await supabase
    .from("quo_inbox_sync")
    .select("window_start, request_token, pair_index, finished_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    window_start: data.window_start,
    request_token: data.request_token,
    pair_index: data.pair_index ?? 0,
    finished_at: data.finished_at,
  };
}

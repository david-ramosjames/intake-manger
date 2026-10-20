import fs from "fs";
import { createSupabaseServiceClient } from "../src/lib/supabase/service";
import { backfillInboxCalls } from "../src/lib/inbox-calls";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const index = line.indexOf("=");
  const key = line.slice(0, index).trim();
  if (!process.env[key]) process.env[key] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const days = Number(process.argv[2] || 28);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const supabase = createSupabaseServiceClient();
  console.log(`syncing inbox calls from ${from.toISOString()} through ${to.toISOString()}`);
  const result = await backfillInboxCalls(supabase, {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    onProgress: (pairs, stored) => console.log(`pairs ${pairs}, stored ${stored}`),
  });
  console.log(`done pairs ${result.pairs}, stored ${result.stored}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

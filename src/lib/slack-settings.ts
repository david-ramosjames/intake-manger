import { LEAD_CHANNEL_ID } from "./slack";
import { createSupabaseServiceClient } from "./supabase/service";

export type SlackSettings = {
  posting: boolean;
  token: string | null;
  tokenSet: boolean;
  channelId: string;
};

export async function loadSlackSettings(): Promise<SlackSettings> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("intake_settings")
    .select("slack_posting, slack_bot_token, slack_channel_id")
    .eq("id", "default")
    .maybeSingle();
  const stored = typeof data?.slack_bot_token === "string" ? data.slack_bot_token.trim() : "";
  const token = stored || process.env.SLACK_BOT_TOKEN?.trim() || null;
  const channel = typeof data?.slack_channel_id === "string" ? data.slack_channel_id.trim() : "";
  return {
    posting: Boolean(data?.slack_posting),
    token,
    tokenSet: Boolean(token),
    channelId: channel || process.env.SLACK_LEAD_CHANNEL_ID || LEAD_CHANNEL_ID,
  };
}

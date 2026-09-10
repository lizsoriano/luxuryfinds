import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "../../../../lib/supabase/admin";
import { getTelegramWebhookSecret } from "../../../../lib/telegram/env";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

/**
 * Telegram webhook receiver. Handles the "/start <client_id>" deep-link message
 * a client sends the first time they open the bot: it links their Telegram chat_id
 * to their Luxury Finds account so we can later send order confirmations.
 *
 * Register this URL with Telegram via setWebhook (see the README instructions this
 * task's final report ships with) — the secret configured there must match
 * TELEGRAM_WEBHOOK_SECRET here.
 */
export async function POST(request: NextRequest) {
  const expectedSecret = getTelegramWebhookSecret();
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    // Malformed payload: acknowledge so Telegram doesn't retry forever.
    return NextResponse.json({ ok: true });
  }

  try {
    const text = update.message?.text?.trim() ?? "";
    const chatId = update.message?.chat?.id;
    const match = /^\/start(?:@\w+)?\s+([0-9a-fA-F-]{36})$/.exec(text);

    if (match && chatId) {
      const clientId = match[1];
      const admin = createAdminSupabaseClient();
      const { error } = await admin
        .schema("luxury_finds")
        .from("clients")
        .update({ telegram_chat_id: chatId })
        .eq("id", clientId);
      if (error) {
        console.error("[telegram webhook] No fue posible vincular telegram_chat_id", error);
      }
    }
  } catch (error) {
    console.error("[telegram webhook] Error procesando el update", error);
  }

  // Always acknowledge with 200 when we can — Telegram retries aggressively otherwise.
  return NextResponse.json({ ok: true });
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabaseClient } from "../../../../lib/supabase/admin";
import { getTelegramWebhookSecret } from "../../../../lib/telegram/env";
import { sendTelegramMessage } from "../../../../lib/telegram/send";

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
      const { data: client, error } = await admin
        .schema("luxury_finds")
        .from("clients")
        .update({ telegram_chat_id: chatId })
        .eq("id", clientId)
        .select("first_name")
        .maybeSingle();
      if (error) {
        console.error("[telegram webhook] No fue posible vincular telegram_chat_id", error);
        await sendTelegramMessage(chatId, "No pudimos vincular tu cuenta. Intenta de nuevo desde tu cuenta en el sitio.");
      } else if (client) {
        await sendTelegramMessage(
          chatId,
          `¡Listo, ${client.first_name}! Tu cuenta de Luxury Finds ya está vinculada. Aquí vas a recibir la confirmación de tus pedidos y pagos. 🛍️`,
        );
      } else {
        await sendTelegramMessage(chatId, "No encontramos esa cuenta. Entra a tu cuenta en el sitio y vuelve a intentar vincular Telegram desde ahí.");
      }
    } else if (chatId) {
      // Any other message (no /start payload, or a plain "hola") - the bot only
      // links accounts and forwards order/payment notifications, it doesn't hold
      // a real conversation. Reply instead of staying silent, which read as "the
      // bot doesn't do anything" even when it was working correctly.
      await sendTelegramMessage(
        chatId,
        "Este bot envía tus confirmaciones de pedidos y pagos de Luxury Finds. Vincula tu cuenta desde el botón \"Vincular Telegram\" en tu perfil del sitio.",
      );
    }
  } catch (error) {
    console.error("[telegram webhook] Error procesando el update", error);
  }

  // Always acknowledge with 200 when we can — Telegram retries aggressively otherwise.
  return NextResponse.json({ ok: true });
}

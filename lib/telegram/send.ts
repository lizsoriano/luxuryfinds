import { hasTelegramEnv, getTelegramEnv } from "./env";

/**
 * Sends a plain-text message to a Telegram chat via the bot API.
 * Fails silently (logs to the server console, returns false) when the bot isn't
 * configured yet or the request fails — callers should never let this block a
 * user-facing flow like checkout.
 */
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
  if (!hasTelegramEnv()) {
    console.warn("[telegram] Envío omitido: TELEGRAM_BOT_TOKEN/TELEGRAM_BOT_USERNAME no configurados.");
    return false;
  }

  try {
    const { botToken } = getTelegramEnv();
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!response.ok) {
      console.error("[telegram] sendMessage falló", response.status, await response.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (error) {
    console.error("[telegram] sendMessage lanzó un error", error);
    return false;
  }
}

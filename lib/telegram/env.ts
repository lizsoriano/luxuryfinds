export function getTelegramEnv() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botToken || !botUsername) {
    throw new Error("Faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_BOT_USERNAME en las variables de entorno.");
  }
  return { botToken, botUsername };
}

export function hasTelegramEnv() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

/** Secret Telegram must send back in the X-Telegram-Bot-Api-Secret-Token header. */
export function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET ?? null;
}

/** Deep-link that starts a conversation with the bot, carrying the client id as the /start payload. */
export function getTelegramLinkUrl(clientId: string) {
  if (!hasTelegramEnv()) return null;
  const { botUsername } = getTelegramEnv();
  return `https://t.me/${botUsername}?start=${clientId}`;
}

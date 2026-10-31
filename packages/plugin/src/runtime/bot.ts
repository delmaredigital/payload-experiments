// Spec §13 Q13: built-in UA list only, with no external lookup or dependency.
const BOT_UA = /\b(?:bot|crawler|spider|googlebot|bingbot|duckduckbot|baiduspider|yandexbot|slurp|bingpreview|facebookexternalhit|facebot|twitterbot|linkedinbot|pinterestbot|whatsapp|telegrambot|applebot|google-inspectiontool|headlesschrome|lighthouse|pagespeed|pingdom|uptimerobot|curl)\b/i

export function isBot(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && BOT_UA.test(userAgent)
}

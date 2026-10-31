// Spec §13 Q13: built-in UA list only, with no external lookup or dependency.
const BOT_UA = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|facebot|twitterbot|linkedinbot|pinterest|whatsapp|telegrambot|applebot|google-inspectiontool|headlesschrome|lighthouse|pagespeed|pingdom|uptimerobot/i

export function isBot(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && BOT_UA.test(userAgent)
}

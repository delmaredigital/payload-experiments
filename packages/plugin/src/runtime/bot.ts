// Spec §13 Q13: built-in UA list only, with no external lookup or dependency.
// `bot` is matched as a suffix of a crawler name (AhrefsBot, GPTBot, AdsBot-Google) but not
// inside device names (CUBOT); the Pinterest app is not a bot, Pinterestbot is.
const BOT_UA = /(?<!cu)bot|crawler|spider|slurp|bingpreview|facebookexternalhit|facebot|whatsapp|google-inspectiontool|headlesschrome|lighthouse|pagespeed|pingdom|uptimerobot|curl|wget|python-requests|go-http-client/i

export function isBot(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && BOT_UA.test(userAgent)
}

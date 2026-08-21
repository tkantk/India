/**
 * The only approved way to reference anything in public/.
 * A literal "/audio/x.m4a" resolves to https://USER.github.io/audio/x.m4a
 * on a project page and 404s. BASE_URL is "./" in production, "/" in dev.
 */
export function assetUrl(relative: string): string {
  const base = import.meta.env.BASE_URL
  return base.replace(/\/$/, '') + '/' + relative.replace(/^\//, '')
}

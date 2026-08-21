/**
 * Narration must be plain text, and this is the one definition of what that
 * means. ElevenLabs returns alignment.characters as a character-for-character
 * image of what was sent, so a stray tag shifts every index after it and
 * silently breaks word highlighting for the rest of the line.
 *
 * Deliberately narrower than /<[^>]+>/, which also rejects legitimate prose
 * like "3 < 5": a tag needs a letter, or a closing slash, immediately after
 * the angle bracket.
 *
 * Enforced by scripts/validate-content.mjs, where it costs nothing, and again
 * as a backstop inside the ElevenLabs provider, where it costs a half-spent
 * pass. Both import from here so they cannot drift apart.
 */
export const MARKUP = /<\/?[a-zA-Z][^>]*>/

/** The offending tag, so the error can quote it, or null if the text is clean. */
export const findMarkup = (text) => String(text).match(MARKUP)?.[0] ?? null

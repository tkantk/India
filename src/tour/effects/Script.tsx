/**
 * "So there are lots of ways to say hello. Watch them pop up. Namaste.
 * Namaskar. Vanakkam."
 *
 * Three cues, one second apart, and they are meant to ACCUMULATE — the beat
 * is about there being more than one of them, which nobody sees if each one
 * replaces the last. So all three are on the card from the start and the one
 * being said right now comes forward while the others sit back.
 *
 * Each greeting is written in its own script, with `lang` set, so the browser
 * picks the right face for Devanagari, Bengali and Tamil instead of guessing.
 */
import { motion } from 'motion/react'
import { EASE_OUT, HOLD, Reveal } from './Reveal'

export const GREETINGS: Record<string, { native: string; roman: string; lang: string }> = {
  namaste: { native: 'नमस्ते', roman: 'Namaste', lang: 'hi' },
  namaskar: { native: 'নমস্কার', roman: 'Namaskar', lang: 'bn' },
  vanakkam: { native: 'வணக்கம்', roman: 'Vanakkam', lang: 'ta' },
}

/** The order the tour says them in. */
const ORDER = ['namaste', 'namaskar', 'vanakkam']

type Props = {
  greeting: string | undefined
  /**
   * Changes on every cue. The component deliberately does NOT remount between
   * the three greetings — that is what lets them accumulate — so this is what
   * tells the card it is wanted again and restarts its hold.
   */
  nonce?: string
}

export function Script({ greeting, nonce }: Props) {
  if (!greeting || !GREETINGS[greeting]) return null

  return (
    <Reveal hold={HOLD.script} restartOn={`${greeting}:${nonce ?? ''}`}>
      <div className="cue-script">
        {ORDER.map((id) => {
          const now = id === greeting
          return (
            <motion.div
              key={id}
              className={now ? 'cue-greeting is-now' : 'cue-greeting'}
              animate={{ scale: now ? 1 : 0.88 }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
            >
              <span className="cue-greeting__native" lang={GREETINGS[id].lang}>
                {GREETINGS[id].native}
              </span>
              <span className="cue-greeting__roman">{GREETINGS[id].roman}</span>
            </motion.div>
          )
        })}
      </div>
    </Reveal>
  )
}

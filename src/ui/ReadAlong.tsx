import { Fragment } from 'react'
import type { Clip } from '../types'
import { useCurrentWord } from '../audio/useNarration'

type Props = {
  clip: Clip | null
}

/**
 * The narrated sentence, with the word being spoken lit up.
 *
 * The lit word comes from `useCurrentWord`, the engine's own clock — never
 * from a `useEffect` keyed on the word index, which would miss a word when
 * two tick in one animation frame and double-fire under StrictMode.
 *
 * Every span shares one static `word` class; only `data-current` changes
 * between renders, so nothing here allocates a style object on the 60Hz
 * word-by-word re-render this component exists for.
 */
export function ReadAlong({ clip }: Props) {
  const current = useCurrentWord()
  if (!clip) return null

  return (
    <p className="read-along">
      {clip.words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="word" data-current={i === current || undefined}>{word}</span>
        </Fragment>
      ))}
    </p>
  )
}

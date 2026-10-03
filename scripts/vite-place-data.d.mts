/**
 * Types for `vite-place-data.mjs`, for the one TypeScript file that imports
 * it: `vite.config.ts`. The plugin itself stays plain `.mjs`, like every
 * other build script in this directory, so Node can run its own test and
 * any script can import its split without a compile step.
 */
import type { Plugin } from 'vite'

export const INDEX_ID: 'virtual:place-data'
export const SHARED_ID: 'virtual:shared-clips'

export type Split = {
  index: { id: string; name: string }[]
  bySlug: Record<string, { place: unknown; clips: Record<string, unknown>; photos: Record<string, unknown> }>
  shared: Record<string, unknown>
}

export function splitPlaceData(input: {
  places: Record<string, unknown>
  timings: Record<string, unknown>
  photos: Record<string, unknown>
}): Split
export function moduleSource(id: string, split: Split): string | null
export function readPlaceData(root?: string): { split: Split; sources: string[] }

export default function placeData(): Plugin

/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * The landmark photographs used to be stripped from `dist/` by a plugin here,
 * because `public/photos/` was 3.5 MB that no code in `src/` referenced and
 * every visitor paid for twenty pictures nobody could see.
 *
 * That plugin's own comment said: "DO NOT FIX THIS BY DELETING THE PLUGIN.
 * When the landmark feature ships, delete it then — and the payload will grow
 * on purpose, in the commit that makes the photographs worth downloading."
 *
 * The landmark feature has shipped. This is that commit. The payload grows on
 * purpose, and the pictures are now the point.
 */

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    /**
     * Git worktrees live under `.claude/worktrees/`, and each one is a FULL
     * checkout of this repo on another branch. Vitest's default excludes do
     * not cover dot-directories, so without this a bare `npm test` collects
     * every sibling branch's tests as well as our own.
     *
     * Measured, not theorised: with three candidate worktrees on disk the
     * suite reported 2,848 tests across 186 files — including 2 failures and
     * 20 skips belonging to other branches — where the real number was 727
     * across 48. That is not merely noisy: it reports another branch's red as
     * ours, and buries our own red in four times its volume of someone
     * else's green. A test count you cannot trust is worse than no test count.
     *
     * CI is unaffected (it checks out a clean tree with no worktrees), which
     * is exactly why this could have gone unnoticed locally for a long time.
     */
    // EXTEND the defaults, never replace them. A hand-written array here
    // silently dropped Vitest's own git-directory exclude — harmless today
    // only because nothing there matches a test glob, and exactly the kind
    // of thing that stops being harmless when the defaults grow.
    // (Line comments, not a block: an exclude glob contains the character
    // pair that would close a block comment early. It did, once.)
    exclude: [...configDefaults.exclude, '**/dist/**', '**/.claude/**'],
  },
})

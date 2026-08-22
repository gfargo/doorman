import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Best-effort check for whether `targetDir` (relative to `cwd`) is covered
 * by a `.gitignore` at the repo root. Intentionally not a full gitignore-
 * semantics implementation (no glob matching, no negation, no nested
 * `.gitignore` merging, no global excludes file) — this backs an advisory
 * nudge, not a correctness guarantee, so a literal/prefix match against the
 * root `.gitignore` is enough: it covers the overwhelmingly common patterns
 * (`backups/`, `/backups`, `backups`) without the complexity of a real
 * gitignore parser. A caller relying on this for anything beyond "should I
 * print a one-line reminder" is using it wrong.
 *
 * Returns `false` (i.e. "not confirmed ignored, consider warning") when
 * there's no git repo or no `.gitignore` at all — callers should treat that
 * as "can't tell" and decide separately whether a warning is even relevant
 * outside a git repo.
 */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, '.git'))
}

export function isDirGitignored(targetDir: string, cwd: string = process.cwd()): boolean {
  const gitignorePath = join(cwd, '.gitignore')
  if (!existsSync(gitignorePath)) {
    return false
  }

  const normalized = targetDir.replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '')

  let lines: string[]
  try {
    lines = readFileSync(gitignorePath, 'utf8').split('\n')
  } catch {
    return false
  }

  return lines.some((rawLine) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) return false
    const pattern = line.replace(/^\//, '').replace(/\/$/, '')
    return pattern === normalized || normalized.startsWith(`${pattern}/`)
  })
}

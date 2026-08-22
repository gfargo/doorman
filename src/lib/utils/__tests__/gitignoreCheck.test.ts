import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { isDirGitignored, isGitRepo } from '../gitignoreCheck'

describe('gitignoreCheck', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'doorman-gitignore-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('isGitRepo', () => {
    it('returns true when .git exists', async () => {
      await fs.mkdir(join(tempDir, '.git'))
      expect(isGitRepo(tempDir)).toBe(true)
    })

    it('returns false when .git does not exist', () => {
      expect(isGitRepo(tempDir)).toBe(false)
    })
  })

  describe('isDirGitignored', () => {
    it('returns false when there is no .gitignore at all', () => {
      expect(isDirGitignored('backups', tempDir)).toBe(false)
    })

    it.each([['backups'], ['backups/'], ['/backups'], ['/backups/']])(
      'matches a %s entry against target "backups"',
      async (entry) => {
        await fs.writeFile(join(tempDir, '.gitignore'), `node_modules\n${entry}\n*.log\n`)
        expect(isDirGitignored('backups', tempDir)).toBe(true)
      },
    )

    it('matches "./backups" the same as "backups"', async () => {
      await fs.writeFile(join(tempDir, '.gitignore'), 'backups/\n')
      expect(isDirGitignored('./backups', tempDir)).toBe(true)
    })

    it('matches a subdirectory of an ignored parent (backups/foo under backups/)', async () => {
      await fs.writeFile(join(tempDir, '.gitignore'), 'backups/\n')
      expect(isDirGitignored('backups/nested', tempDir)).toBe(true)
    })

    it('ignores comments and blank lines rather than matching them', async () => {
      await fs.writeFile(join(tempDir, '.gitignore'), '# backups\n\n  \nnode_modules\n')
      expect(isDirGitignored('backups', tempDir)).toBe(false)
    })

    it('returns false when .gitignore has unrelated entries only', async () => {
      await fs.writeFile(join(tempDir, '.gitignore'), 'node_modules\ndist\n*.log\n')
      expect(isDirGitignored('backups', tempDir)).toBe(false)
    })

    it('does not treat a name that merely starts with the same prefix as a match', async () => {
      // "backups-archive" should not be considered covered by a "backups/" entry
      await fs.writeFile(join(tempDir, '.gitignore'), 'backups/\n')
      expect(isDirGitignored('backups-archive', tempDir)).toBe(false)
    })
  })
})

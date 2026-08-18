---
inclusion: manual
---

# Wiki & Docs Workflow

## Architecture

The `/docs` section of the marketing site (`.www`) is powered by the **GitHub Wiki** as a CMS. Content lives on the wiki; the site fetches raw markdown at build/request time via ISR (1-hour revalidation).

### Key Locations

| What                          | Where                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| Wiki repo (local checkout)    | `.wiki/` (separate git repo, ignored by main `.gitignore`) |
| Wiki manifest (page registry) | `.www/lib/wiki/wiki-manifest.ts`                           |
| Fetch + caching layer         | `.www/lib/wiki/fetch-wiki.ts`                              |
| Markdown processing           | `.www/lib/wiki/markdown.ts`                                |
| Docs components               | `.www/components/docs/`                                    |
| Docs pages (Next.js)          | `.www/app/docs/` and `.www/app/docs/[slug]/`               |
| Architecture reference        | `docs/DOCS_WIKI_ARCHITECTURE_SKILL.md`                     |

### Content URL Pattern

Every wiki page is fetchable as raw markdown:

```
https://raw.githubusercontent.com/wiki/gfargo/doorman/{Page-Name}.md
```

## Adding a New Doc Page

1. **Create the wiki page** — either edit on GitHub Wiki UI or create a `.md` file in `.wiki/` and push:

   ```bash
   # Edit locally
   vim .wiki/My-New-Page.md
   git -C .wiki add -A && git -C .wiki commit -m "docs: add My New Page" && git -C .wiki push
   ```

2. **Register in the manifest** — add an entry to `.www/lib/wiki/wiki-manifest.ts`:

   ```typescript
   {
     slug: 'my-new-page',
     title: 'My New Page',
     wikiPath: 'My-New-Page',
     category: 'Guides',
     order: 2,
     description: 'Short description for SEO and index cards.',
   }
   ```

3. **Update the wiki sidebar** — edit `.wiki/_Sidebar.md` to include the new page:

   ```markdown
   **Guides**

   - [[CI-CD Integration]]
   - [[My New Page]]
   ```

4. **Verify** — run `pnpm build` in `.www/` to confirm static generation picks up the new slug.

## Editing Existing Content

- Edit the `.md` file in `.wiki/`, commit, and push. Content refreshes within 1 hour (ISR) or on next deploy.
- To update metadata (title, description, category, order), edit `wiki-manifest.ts`.

## Wiki Link Conventions

- Use `[[Page Title]]` syntax in wiki markdown for internal links — the markdown processor converts these to `/docs/{slug}` routes.
- Absolute GitHub Wiki URLs (`https://github.com/gfargo/doorman/wiki/Page-Name`) are also auto-transformed.
- External links render with an external-link icon automatically.

## Category System

Categories are defined implicitly by the `category` field on each page in the manifest. Display order is controlled by `CATEGORY_ORDER` in `wiki-manifest.ts`:

```typescript
const CATEGORY_ORDER: Record<string, number> = {
  'Getting Started': 1,
  Configuration: 2,
  Commands: 3,
  Guides: 4,
}
```

To add a new category, just use a new `category` string on a page entry and add it to `CATEGORY_ORDER`.

## Build & Deploy

- `pnpm build` in `.www/` runs the prebuild (schema download) then Next.js build, which statically generates all `/docs/[slug]` pages via `generateStaticParams`.
- ISR revalidates every hour. A Vercel redeploy picks up all changes immediately.
- The `getting-started` route redirects to `/docs/getting-started`.

## What Lives Where

| Content type                         | Location                                      | Notes                                   |
| ------------------------------------ | --------------------------------------------- | --------------------------------------- |
| User-facing docs & guides            | GitHub Wiki (`.wiki/`)                        | Single source of truth                  |
| Page registry & metadata             | `.www/lib/wiki/wiki-manifest.ts`              | Slugs, titles, categories, descriptions |
| Internal planning docs               | `docs/phases/`                                | Active planning only (Phase 6)          |
| Architecture reference (this system) | `docs/DOCS_WIKI_ARCHITECTURE_SKILL.md`        | Developer reference, not user-facing    |
| Future roadmap                       | `docs/ADVANCED_FEATURES_ROADMAP.md`           | v2.x+ feature planning                  |
| Cloudflare API reference             | `docs/cloudflare/CLOUDFLARE_WAF_REFERENCE.md` | Technical API reference for developers  |
| Archived marketing content           | `docs/blog/`                                  | Blog post and project showcase drafts   |

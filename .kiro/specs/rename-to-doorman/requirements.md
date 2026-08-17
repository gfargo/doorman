# Requirements Document

## Introduction

This spec covers the renaming of the project from `vercel-doorman` to `@gfargo/doorman` on npm (binary: `doorman`). The rename reflects the multi-provider direction (Vercel + Cloudflare) and removes Vercel-specific branding that no longer accurately represents the tool's scope.

## Requirements

### Requirement 1: Package Identity Update

**User Story:** As a user installing the tool, I want to install it under a name that reflects its multi-provider nature, so that the branding doesn't imply it only works with Vercel.

#### Acceptance Criteria

1. WHEN I run `npm install -g @gfargo/doorman` THEN the package SHALL install successfully and provide the `doorman` binary
2. WHEN I run `doorman --help` THEN it SHALL show correct branding without "vercel" in the tool name
3. WHEN the package is published THEN it SHALL be available as `@gfargo/doorman` on npm
4. WHEN users search for the old package name THEN `vercel-doorman` SHALL show a deprecation notice pointing to `@gfargo/doorman`

### Requirement 2: Backward-Compatible Binary Transition

**User Story:** As an existing user with `vercel-doorman` in my scripts, I want a deprecation period where the old binary still works, so that I have time to update my automation.

#### Acceptance Criteria

1. WHEN I run `vercel-doorman` during the deprecation period THEN it SHALL print a deprecation warning and delegate to `doorman`
2. WHEN the deprecation window expires (6 months) THEN the `vercel-doorman` binary SHALL be removed
3. WHEN I run `npx vercel-doorman` THEN it SHALL show the deprecation message and suggest using `@gfargo/doorman`

### Requirement 3: Configuration File Continuity

**User Story:** As an existing user with `vercel-firewall.config.json`, I want my existing config to still be discovered and loaded, so that the rename doesn't break my setup.

#### Acceptance Criteria

1. WHEN I have a `.doorman.json` file THEN it SHALL be discovered as the primary config file
2. WHEN I have a legacy `vercel-firewall.config.json` file THEN it SHALL still be loaded with a deprecation warning
3. WHEN both config files exist THEN `.doorman.json` SHALL take precedence
4. WHEN legacy config support is removed in 3.0 THEN clear migration guidance SHALL be provided beforehand

### Requirement 4: Source Code and Documentation Update

**User Story:** As a contributor or user reading docs, I want all references to accurately reflect the new name, so that there's no confusion about the project identity.

#### Acceptance Criteria

1. WHEN I read CLI help text, error messages, or logs THEN they SHALL reference "doorman" not "vercel-doorman"
2. WHEN I read the README or wiki THEN install commands and references SHALL use the new package name
3. WHEN I look at the JSON Schema THEN the title/description SHALL reflect the new name
4. WHEN I look at the GitHub repo THEN it SHALL be renamed to `gfargo/doorman` with an auto-redirect from the old URL

### Requirement 5: Repository and Ecosystem Migration

**User Story:** As a maintainer, I want the GitHub repo, CI/CD, and external references updated cleanly, so that the project has a consistent identity everywhere.

#### Acceptance Criteria

1. WHEN the GitHub repo is renamed THEN branch protections, secrets, and Actions SHALL continue to function
2. WHEN CI/CD runs on `main` or `beta` THEN semantic-release SHALL publish to `@gfargo/doorman`
3. WHEN users visit the old GitHub URL THEN they SHALL be redirected to the new repo
4. WHEN the website is updated THEN install commands, meta tags, and docs links SHALL reflect the new name

### Requirement 6: Version Bump Strategy

**User Story:** As a user tracking releases, I want the rename to be signaled as a breaking change, so that I know to update my install commands.

#### Acceptance Criteria

1. WHEN the rename is merged THEN it SHALL trigger a major version bump (breaking change)
2. WHEN the release is published THEN the commit message SHALL use `feat!:` or `BREAKING CHANGE:` footer
3. WHEN users see the new version THEN the changelog SHALL clearly explain the rename and migration steps

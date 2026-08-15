# [2.1.0](https://github.com/gfargo/vercel-doorman/compare/v2.0.0...v2.1.0) (2026-05-08)


### Bug Fixes

* **ci:** use --no-frozen-lockfile and pin pnpm@10 ([13a818c](https://github.com/gfargo/vercel-doorman/commit/13a818ce4d556ca4662f7aad7f000cf1318ae78a))


### Features

* add `add` command for creating rules from CLI ([#71](https://github.com/gfargo/vercel-doorman/issues/71)) ([01a901b](https://github.com/gfargo/vercel-doorman/commit/01a901bef17ec0211cc643a3977499ed9cf7db3e)), closes [#69](https://github.com/gfargo/vercel-doorman/issues/69)
* add `remove` command for deleting rules from CLI ([#72](https://github.com/gfargo/vercel-doorman/issues/72)) ([ec3251d](https://github.com/gfargo/vercel-doorman/commit/ec3251d3a9e5005a96fd5acacdf80a1436bbe076)), closes [#70](https://github.com/gfargo/vercel-doorman/issues/70)

# [2.0.0](https://github.com/gfargo/vercel-doorman/compare/v1.5.10...v2.0.0) (2026-05-05)


* feat!: pre-2.0 cleanup — tests, dead code removal, .doorman.json config rename ([3d2bd96](https://github.com/gfargo/vercel-doorman/commit/3d2bd96fb6e5ecd7b66c1f870a7174ff9deb3a51))


### Bug Fixes

* enable all 12 skipped Cloudflare test suites (286 new passing tests) ([0ff56f3](https://github.com/gfargo/vercel-doorman/commit/0ff56f3d81f2591e0f1af42212d4eba78b29503c))
* exclude .www from jest module paths ([4a5beae](https://github.com/gfargo/vercel-doorman/commit/4a5beae3fa3312ac55f138f12f090acf5daea7eb))
* remove dead code in schemaVersion/gracefulShutdown/networkResilience, add remaining tests ([b6f410a](https://github.com/gfargo/vercel-doorman/commit/b6f410a245d7142bfcad2d776d7e809af11e6975))
* resolve all lint errors for CI release ([49efd29](https://github.com/gfargo/vercel-doorman/commit/49efd29caa6765596c7188205e8261441d123104))
* strip Vercel API validation metadata from downloaded rules ([6916e59](https://github.com/gfargo/vercel-doorman/commit/6916e59b0c34c2200da06762378f9369f3836775))


### Features

* add agent SKILL.md for 2.0 with multi-provider support ([93ad696](https://github.com/gfargo/vercel-doorman/commit/93ad696b998d619029492ccc33c5a3b3dfe0d688))
* add agents.skills entry to package.json for skill discovery ([90753e2](https://github.com/gfargo/vercel-doorman/commit/90753e289c4f6f94a3194ecb48710851056ff929))
* integrate Cloudflare provider with provider-aware middleware (v2.0.0-beta) ([2b86134](https://github.com/gfargo/vercel-doorman/commit/2b86134b4f19ea1aed7a3faf6a63709c052cb667))
* use .doorman.json as default config filename ([d608307](https://github.com/gfargo/vercel-doorman/commit/d608307d98515c97dbbc417de673a0e2e77b2f7f))


### BREAKING CHANGES

* Default config filename changed from vercel-firewall.config.json to .doorman.json. Existing configs are still auto-detected and work without changes.

# [2.0.0-beta.3](https://github.com/gfargo/vercel-doorman/compare/v2.0.0-beta.2...v2.0.0-beta.3) (2026-05-05)


### Features

* add agent SKILL.md for 2.0 with multi-provider support ([93ad696](https://github.com/gfargo/vercel-doorman/commit/93ad696b998d619029492ccc33c5a3b3dfe0d688))

# [2.0.0-beta.2](https://github.com/gfargo/vercel-doorman/compare/v2.0.0-beta.1...v2.0.0-beta.2) (2026-05-05)


### Bug Fixes

* strip Vercel API validation metadata from downloaded rules ([6916e59](https://github.com/gfargo/vercel-doorman/commit/6916e59b0c34c2200da06762378f9369f3836775))

# [2.0.0-beta.1](https://github.com/gfargo/vercel-doorman/compare/v1.6.0-beta.1...v2.0.0-beta.1) (2026-05-05)


* feat!: pre-2.0 cleanup — tests, dead code removal, .doorman.json config rename ([3d2bd96](https://github.com/gfargo/vercel-doorman/commit/3d2bd96fb6e5ecd7b66c1f870a7174ff9deb3a51))


### Bug Fixes

* enable all 12 skipped Cloudflare test suites (286 new passing tests) ([0ff56f3](https://github.com/gfargo/vercel-doorman/commit/0ff56f3d81f2591e0f1af42212d4eba78b29503c))
* exclude .www from jest module paths ([4a5beae](https://github.com/gfargo/vercel-doorman/commit/4a5beae3fa3312ac55f138f12f090acf5daea7eb))
* remove dead code in schemaVersion/gracefulShutdown/networkResilience, add remaining tests ([b6f410a](https://github.com/gfargo/vercel-doorman/commit/b6f410a245d7142bfcad2d776d7e809af11e6975))


### Features

* use .doorman.json as default config filename ([d608307](https://github.com/gfargo/vercel-doorman/commit/d608307d98515c97dbbc417de673a0e2e77b2f7f))


### BREAKING CHANGES

* Default config filename changed from vercel-firewall.config.json to .doorman.json. Existing configs are still auto-detected and work without changes.

# [1.6.0-beta.1](https://github.com/gfargo/vercel-doorman/compare/v1.5.10...v1.6.0-beta.1) (2026-05-04)


### Features

* integrate Cloudflare provider with provider-aware middleware (v2.0.0-beta) ([2b86134](https://github.com/gfargo/vercel-doorman/commit/2b86134b4f19ea1aed7a3faf6a63709c052cb667))

## [1.5.10](https://github.com/gfargo/vercel-doorman/compare/v1.5.9...v1.5.10) (2026-05-03)


### Bug Fixes

* address Copilot review feedback on PR [#63](https://github.com/gfargo/vercel-doorman/issues/63) ([0cdc00a](https://github.com/gfargo/vercel-doorman/commit/0cdc00a4d6e1acc2d4020b3938c8361e3ae95dcb))
* resolve CLI audit issues [#57](https://github.com/gfargo/vercel-doorman/issues/57)-[#62](https://github.com/gfargo/vercel-doorman/issues/62) ([25e3d4a](https://github.com/gfargo/vercel-doorman/commit/25e3d4af055e5ed2e388cdd964e9ddcfb9530971)), closes [#59](https://github.com/gfargo/vercel-doorman/issues/59) [#60](https://github.com/gfargo/vercel-doorman/issues/60) [#55](https://github.com/gfargo/vercel-doorman/issues/55)
* resolve prettier formatting error in FirewallService.ts ([3dc0326](https://github.com/gfargo/vercel-doorman/commit/3dc0326c707752ccd3085c69c0febbc9eeac387a))

## [1.5.9](https://github.com/gfargo/vercel-doorman/compare/v1.5.8...v1.5.9) (2026-05-03)


### Bug Fixes

* **deps:** override handlebars to >=4.7.9 ([5c11bbd](https://github.com/gfargo/vercel-doorman/commit/5c11bbdc9762ed637ace76cf861550d334576591)), closes [#2](https://github.com/gfargo/vercel-doorman/issues/2)
* package.json & pnpm-lock.yaml to reduce vulnerabilities ([b67ea9c](https://github.com/gfargo/vercel-doorman/commit/b67ea9ca1f9d01991a38621343bf36469e95a20b))

## [1.5.8](https://github.com/gfargo/vercel-doorman/compare/v1.5.7...v1.5.8) (2025-10-06)


### Bug Fixes

* resolve security vulnerabilities and improve test coverage ([9d1fd0b](https://github.com/gfargo/vercel-doorman/commit/9d1fd0b1bad6e1930762a0d0bf5b05f068518c24))

## [1.5.7](https://github.com/gfargo/vercel-doorman/compare/v1.5.6...v1.5.7) (2024-12-10)


### Bug Fixes

* update Vercel client and error handling ([f7df377](https://github.com/gfargo/vercel-doorman/commit/f7df377e4f541fd6ebf68f2e29810189cd0dec3e))

## [1.5.6](https://github.com/gfargo/vercel-doorman/compare/v1.5.5...v1.5.6) (2024-12-09)


### Performance Improvements

* add JSON Schema support ([06c2a47](https://github.com/gfargo/vercel-doorman/commit/06c2a473f78f94b80e9eb84a01db6dea9541dd19))

## [1.5.5](https://github.com/gfargo/vercel-doorman/compare/v1.5.4...v1.5.5) (2024-12-09)


### Bug Fixes

* add config creation prompt ([14afdd7](https://github.com/gfargo/vercel-doorman/commit/14afdd76d94dad8b44e815a2eb9f3fcfffeb53a9))

## [1.5.4](https://github.com/gfargo/vercel-doorman/compare/v1.5.3...v1.5.4) (2024-12-09)


### Bug Fixes

* migrate templates to TypeScript ([7a6c7ff](https://github.com/gfargo/vercel-doorman/commit/7a6c7ff059ae63a16a2048ffdc35513237c047e8))
* remove newline in success message ([22c74e5](https://github.com/gfargo/vercel-doorman/commit/22c74e516604ea206959337aecbe5578e82cc9e1))

## [1.5.3](https://github.com/gfargo/vercel-doorman/compare/v1.5.2...v1.5.3) (2024-12-06)


### Bug Fixes

* enforce array for `inc` operator values ([8b7f09d](https://github.com/gfargo/vercel-doorman/commit/8b7f09dbeb82bff38de3a4f177345c5c98637f3f))

## [1.5.2](https://github.com/gfargo/vercel-doorman/compare/v1.5.1...v1.5.2) (2024-12-06)


### Bug Fixes

* enhance condition formatting ([bb07348](https://github.com/gfargo/vercel-doorman/commit/bb07348f8e52357db6b00d29a69a04b7c023f9de))
* update schema and examples for consistency ([3b9c55e](https://github.com/gfargo/vercel-doorman/commit/3b9c55eda396d4371403db18a7a1a9408c9be8bc))

## [1.5.1](https://github.com/gfargo/vercel-doorman/compare/v1.5.0...v1.5.1) (2024-12-06)


### Bug Fixes

* remove auto-generated comment ([6f1622c](https://github.com/gfargo/vercel-doorman/commit/6f1622cfeb2dc817519f47eccd2614cea0ce79aa))

# [1.5.0](https://github.com/gfargo/vercel-doorman/compare/v1.4.0...v1.5.0) (2024-12-06)


### Features

* add new templates for bot detection and OFAC rules ([f720a76](https://github.com/gfargo/vercel-doorman/commit/f720a76412211c9960d6538378093dd90d7ed30c))
* add template command and config utils ([9685b99](https://github.com/gfargo/vercel-doorman/commit/9685b9999f4ae33bebfff1ddf36ef38a17f5ec60))

# [1.4.0](https://github.com/gfargo/vercel-doorman/compare/v1.3.3...v1.4.0) (2024-11-30)


### Bug Fixes

* enhance sync and update IP rules ([48cf546](https://github.com/gfargo/vercel-doorman/commit/48cf5465e0e04bc318a46ca99b68018242f11b45))


### Features

* add config version support to download command ([29a3bc6](https://github.com/gfargo/vercel-doorman/commit/29a3bc6651ea3297fd4759a550deb58b14f7048f))
* add config version support to list command ([5d84b78](https://github.com/gfargo/vercel-doorman/commit/5d84b787740100c4386e656e909814549dd0d22d))

## [1.3.3](https://github.com/gfargo/vercel-doorman/compare/v1.3.2...v1.3.3) (2024-11-30)


### Bug Fixes

* add dynamic column width calculation ([3a2a5ff](https://github.com/gfargo/vercel-doorman/commit/3a2a5ff12655c408065dd2e80759548075dcdc94))


### Performance Improvements

* enhance rule validation and logging ([6d606d2](https://github.com/gfargo/vercel-doorman/commit/6d606d22a3d5e9f05180198eb538e88f687309a0))

## [1.3.2](https://github.com/gfargo/vercel-doorman/compare/v1.3.1...v1.3.2) (2024-11-28)


### Bug Fixes

* enhance config handling in download command ([b100716](https://github.com/gfargo/vercel-doorman/commit/b10071689bb643cb511ccac4f0c9de5e7141a2de))

## [1.3.1](https://github.com/gfargo/vercel-doorman/compare/v1.3.0...v1.3.1) (2024-11-27)


### Performance Improvements

* improve logging for sync process ([beadcd1](https://github.com/gfargo/vercel-doorman/commit/beadcd13494ccbda48b69a8e7e1fef19a4a1c4b8))

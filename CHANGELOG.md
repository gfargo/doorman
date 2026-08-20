# [3.5.0](https://github.com/gfargo/doorman/compare/v3.4.0...v3.5.0) (2026-08-20)


### Features

* migrate diff, list, status, and download onto IFirewallProvider for Vercel ([#174](https://github.com/gfargo/doorman/issues/174)) ([80c65d4](https://github.com/gfargo/doorman/commit/80c65d46375bba6419b1e0fd31f4964bec493bd0))

# [3.4.0](https://github.com/gfargo/doorman/compare/v3.3.1...v3.4.0) (2026-08-20)


### Features

* migrate sync and watch onto IFirewallProvider for Vercel ([#173](https://github.com/gfargo/doorman/issues/173)) ([03b5b5a](https://github.com/gfargo/doorman/commit/03b5b5a843a2d32dc6e0aaf631d0692947fdae5c))

## [3.3.1](https://github.com/gfargo/doorman/compare/v3.3.0...v3.3.1) (2026-08-19)


### Bug Fixes

* resolve Vercel projectId/teamId from config in both legacy and unified shapes ([67b3e01](https://github.com/gfargo/doorman/commit/67b3e016af613618d21274837b5317237f493e9e))

# [3.3.0](https://github.com/gfargo/doorman/compare/v3.2.5...v3.3.0) (2026-08-19)


### Features

* lay foundation for migrating Vercel CLI onto IFirewallProvider ([43cdf19](https://github.com/gfargo/doorman/commit/43cdf192bb5665518aad3e4282e284e01fb02778))

## [3.2.5](https://github.com/gfargo/doorman/compare/v3.2.4...v3.2.5) (2026-08-19)


### Bug Fixes

* preserve condition-group fidelity in Vercel<->Unified translation ([f02e929](https://github.com/gfargo/doorman/commit/f02e9294104bf3e3d2c9292ba98e9c7f2b1ffc42))

## [3.2.4](https://github.com/gfargo/doorman/compare/v3.2.3...v3.2.4) (2026-08-19)


### Bug Fixes

* clean up notes clearing, referer key, duplicate ids, redundant retry ([f7e611f](https://github.com/gfargo/doorman/commit/f7e611f12d7409aa6a97fbfbaef7e2ed891b10d6)), closes [#150](https://github.com/gfargo/doorman/issues/150) [#151](https://github.com/gfargo/doorman/issues/151) [#152](https://github.com/gfargo/doorman/issues/152) [#154](https://github.com/gfargo/doorman/issues/154)

## [3.2.3](https://github.com/gfargo/doorman/compare/v3.2.2...v3.2.3) (2026-08-19)


### Bug Fixes

* harden Cloudflare Lists API and IP-rule handling ([90c2e12](https://github.com/gfargo/doorman/commit/90c2e121c7dcea6697f37f7f6e66e0b8eee5e76e)), closes [#146](https://github.com/gfargo/doorman/issues/146) [#147](https://github.com/gfargo/doorman/issues/147) [#148](https://github.com/gfargo/doorman/issues/148) [#149](https://github.com/gfargo/doorman/issues/149)

## [3.2.2](https://github.com/gfargo/doorman/compare/v3.2.1...v3.2.2) (2026-08-19)


### Bug Fixes

* diff Cloudflare rules in native space, keep IP-list rule across syncs ([02dca71](https://github.com/gfargo/doorman/commit/02dca718b651e4be5ad08c1004904d4a028d86d6)), closes [#2](https://github.com/gfargo/doorman/issues/2) [#1](https://github.com/gfargo/doorman/issues/1) [#1](https://github.com/gfargo/doorman/issues/1) [#153](https://github.com/gfargo/doorman/issues/153) [#158](https://github.com/gfargo/doorman/issues/158) [#159](https://github.com/gfargo/doorman/issues/159) [#160](https://github.com/gfargo/doorman/issues/160)
* stop Vercel sync from corrupting rules and discarding real errors ([b3091d6](https://github.com/gfargo/doorman/commit/b3091d6b6e08afdb041502bc9c2904d085ca713b)), closes [#164](https://github.com/gfargo/doorman/issues/164) [#161](https://github.com/gfargo/doorman/issues/161) [#162](https://github.com/gfargo/doorman/issues/162) [#163](https://github.com/gfargo/doorman/issues/163)

## [3.2.1](https://github.com/gfargo/doorman/compare/v3.2.0...v3.2.1) (2026-08-19)


### Bug Fixes

* require explicit --allow-deletions for non-interactive rule deletions ([#164](https://github.com/gfargo/doorman/issues/164)) ([1ed794d](https://github.com/gfargo/doorman/commit/1ed794dbb40f076d42d3bc173f5406ebfbad9ef0)), closes [#157](https://github.com/gfargo/doorman/issues/157)

# [3.2.0](https://github.com/gfargo/doorman/compare/v3.1.0...v3.2.0) (2026-08-18)


### Features

* restructure skill to Agent Skills spec with progressive disclosure ([7ffeba6](https://github.com/gfargo/doorman/commit/7ffeba60c0eb0b0fdadaddcd1387613da943704a))

# [3.1.0](https://github.com/gfargo/doorman/compare/v3.0.9...v3.1.0) (2026-08-18)


### Features

* add import-existing demo tape ([#142](https://github.com/gfargo/doorman/issues/142)) ([6e990ba](https://github.com/gfargo/doorman/commit/6e990ba6566ce276fb4e719be17320304aef6e05))

## [3.0.9](https://github.com/gfargo/doorman/compare/v3.0.8...v3.0.9) (2026-08-17)


### Bug Fixes

* make template --dryRun preview the duplicate-name warning too ([#140](https://github.com/gfargo/doorman/issues/140)) ([a4dba8b](https://github.com/gfargo/doorman/commit/a4dba8b0f6f84f60b6522b812627b7052f3b5131)), closes [#97](https://github.com/gfargo/doorman/issues/97)

## [3.0.8](https://github.com/gfargo/doorman/compare/v3.0.7...v3.0.8) (2026-08-17)


### Bug Fixes

* stop quoting IP values in wirefilter expressions for ip.src ([#139](https://github.com/gfargo/doorman/issues/139)) ([6811e49](https://github.com/gfargo/doorman/commit/6811e49ed70316719c361cf8795aa5762ffa9d92)), closes [#85](https://github.com/gfargo/doorman/issues/85) [#108](https://github.com/gfargo/doorman/issues/108) [#109](https://github.com/gfargo/doorman/issues/109) [#119](https://github.com/gfargo/doorman/issues/119)

## [3.0.7](https://github.com/gfargo/doorman/compare/v3.0.6...v3.0.7) (2026-08-17)


### Bug Fixes

* accept IPv6 addresses and CIDR ranges in Cloudflare IP validation ([#121](https://github.com/gfargo/doorman/issues/121)) ([a2e1297](https://github.com/gfargo/doorman/commit/a2e12973b5e362744a4dd6389d853e57c4d61ec0)), closes [#87](https://github.com/gfargo/doorman/issues/87)
* accept standard compressed IPv6 notation in Vercel validation ([#126](https://github.com/gfargo/doorman/issues/126)) ([ce0558f](https://github.com/gfargo/doorman/commit/ce0558f900b59a548147fbdeb4259e81e705847f)), closes [#87](https://github.com/gfargo/doorman/issues/87) [#95](https://github.com/gfargo/doorman/issues/95)
* allowlist-reconstruct IP rules too when sanitizing a backup ([#137](https://github.com/gfargo/doorman/issues/137)) ([b9068ec](https://github.com/gfargo/doorman/commit/b9068ec8397c142120230b1ba28f070eef34f5b3)), closes [#112](https://github.com/gfargo/doorman/issues/112) [#114](https://github.com/gfargo/doorman/issues/114)
* cap rate-limit wait derived from X-RateLimit-Reset at 1 minute ([#127](https://github.com/gfargo/doorman/issues/127)) ([5287f9d](https://github.com/gfargo/doorman/commit/5287f9da843a7452657f83896f10aa4d9d5419c0)), closes [#96](https://github.com/gfargo/doorman/issues/96)
* emit valid wirefilter syntax for negated Cloudflare operators ([#119](https://github.com/gfargo/doorman/issues/119)) ([541b90c](https://github.com/gfargo/doorman/commit/541b90c30e321b93932c0ed26b378a952369a9d6)), closes [#85](https://github.com/gfargo/doorman/issues/85)
* give Vercel sync the same dry-run/confirmation safety as Cloudflare ([#129](https://github.com/gfargo/doorman/issues/129)) ([aaa4d4b](https://github.com/gfargo/doorman/commit/aaa4d4bf38fcfb3ea574118e786912f1fb224d56)), closes [#104](https://github.com/gfargo/doorman/issues/104)
* mask API token input instead of echoing it in plaintext ([#133](https://github.com/gfargo/doorman/issues/133)) ([a146644](https://github.com/gfargo/doorman/commit/a14664473ea98713627be254588a0654a4c6b3ea)), closes [#102](https://github.com/gfargo/doorman/issues/102)
* pin @semantic-release/npm to the OIDC-capable v13 line ([#122](https://github.com/gfargo/doorman/issues/122)) ([ed0a457](https://github.com/gfargo/doorman/commit/ed0a457da4176d01c5bff64ae7598019e9a71bd0)), closes [#88](https://github.com/gfargo/doorman/issues/88)
* retry() re-throws the original error instead of a generic wrapper ([#125](https://github.com/gfargo/doorman/issues/125)) ([08be4d6](https://github.com/gfargo/doorman/commit/08be4d60c960689ce04612dab24918bc176f7504)), closes [#94](https://github.com/gfargo/doorman/issues/94)
* stop leaking partial API tokens into debug logs ([#132](https://github.com/gfargo/doorman/issues/132)) ([b762edd](https://github.com/gfargo/doorman/commit/b762edd6a383cf39bd2a8553ba4f24148612637e)), closes [#101](https://github.com/gfargo/doorman/issues/101)
* stop logging the raw Vercel API token in debug output ([#118](https://github.com/gfargo/doorman/issues/118)) ([c97917f](https://github.com/gfargo/doorman/commit/c97917f6b53136380dcc4ab2c9da7c4e44b635fa)), closes [#100](https://github.com/gfargo/doorman/issues/100)
* stop prompting for Vercel credentials twice on first run ([#124](https://github.com/gfargo/doorman/issues/124)) ([4f32564](https://github.com/gfargo/doorman/commit/4f325646aa982ae82c782243b0f47245aac7a45d)), closes [#93](https://github.com/gfargo/doorman/issues/93)
* template command honors --config and warns on duplicate rule names ([#128](https://github.com/gfargo/doorman/issues/128)) ([5a72597](https://github.com/gfargo/doorman/commit/5a725973ae882d527c3147bc5868fb611b7a305f)), closes [#97](https://github.com/gfargo/doorman/issues/97)
* use wirefilter's in operator for CIDR IP-blocking rules ([#120](https://github.com/gfargo/doorman/issues/120)) ([1e90c7c](https://github.com/gfargo/doorman/commit/1e90c7cf16dd855330f68f3f40ddef053dc0ddeb)), closes [#86](https://github.com/gfargo/doorman/issues/86)

## [3.0.6](https://github.com/gfargo/doorman/compare/v3.0.5...v3.0.6) (2026-08-17)


### Bug Fixes

* recognize CIDR and IPv6 IP-blocking rules on Cloudflare fetchConfig ([#123](https://github.com/gfargo/doorman/issues/123)) ([58d57fa](https://github.com/gfargo/doorman/commit/58d57fadd9d0957135ccde7a9a476b5746bb4e78))

## [3.0.5](https://github.com/gfargo/doorman/compare/v3.0.4...v3.0.5) (2026-08-17)


### Bug Fixes

* strip backup metadata before validating restored config ([#117](https://github.com/gfargo/doorman/issues/117)) ([1d05105](https://github.com/gfargo/doorman/commit/1d05105d90bea9e5d61562bed780fb40f457f339)), closes [#113](https://github.com/gfargo/doorman/issues/113)

## [3.0.4](https://github.com/gfargo/doorman/compare/v3.0.3...v3.0.4) (2026-08-17)


### Bug Fixes

* validate fetched config before writing a backup, not skip validation entirely ([#112](https://github.com/gfargo/doorman/issues/112)) ([be38793](https://github.com/gfargo/doorman/commit/be3879346e1508cd38d72d9ce0869d91b3e1827e))

## [3.0.3](https://github.com/gfargo/doorman/compare/v3.0.2...v3.0.3) (2026-08-17)


### Bug Fixes

* harden remaining Wirefilter injection sites in rule translation ([#109](https://github.com/gfargo/doorman/issues/109)) ([d5d68d5](https://github.com/gfargo/doorman/commit/d5d68d52a1db6134e59c529e3e279ab69f42c433)), closes [#84](https://github.com/gfargo/doorman/issues/84)
* surface sync warnings in watch mode ([#110](https://github.com/gfargo/doorman/issues/110)) ([533eebf](https://github.com/gfargo/doorman/commit/533eebfda0b36adf6132bfad2d4b64226841bd13))

## [3.0.2](https://github.com/gfargo/doorman/compare/v3.0.1...v3.0.2) (2026-08-17)


### Bug Fixes

* close Wirefilter injection, fix Cloudflare warning handling, add test coverage ([#108](https://github.com/gfargo/doorman/issues/108)) ([88033a8](https://github.com/gfargo/doorman/commit/88033a8684e4cc2ec8c379ab592c56ac8e87b074)), closes [#82](https://github.com/gfargo/doorman/issues/82) [#83](https://github.com/gfargo/doorman/issues/83) [#84](https://github.com/gfargo/doorman/issues/84) [#98](https://github.com/gfargo/doorman/issues/98)

## [3.0.1](https://github.com/gfargo/doorman/compare/v3.0.0...v3.0.1) (2026-08-17)


### Bug Fixes

* make Cloudflare provider actually work for sync/status/diff/watch/backup/download/export/list ([#107](https://github.com/gfargo/doorman/issues/107)) ([d6f8e0f](https://github.com/gfargo/doorman/commit/d6f8e0f21cef49d3d7fa6ec56756cbb8add250d6)), closes [#82](https://github.com/gfargo/doorman/issues/82)

# [3.0.0](https://github.com/gfargo/doorman/compare/v2.2.0...v3.0.0) (2026-08-16)


* feat!: rename package from vercel-doorman to @gfargo/doorman ([c5676ec](https://github.com/gfargo/doorman/commit/c5676ec66440ce0a08a0f9d0564cd9db9ae42f0d)), closes [#74](https://github.com/gfargo/doorman/issues/74)


### Bug Fixes

* **publish:** set publishConfig.access public for the scoped package ([510145f](https://github.com/gfargo/doorman/commit/510145f6148db9a24beefb2f6cf0008908aa988f))


### BREAKING CHANGES

* Package name changed from `vercel-doorman` to `@gfargo/doorman`.
Install with `npm i -g @gfargo/doorman`. The `vercel-doorman` binary is deprecated
and will be removed in a future release.

- Renamed npm package to @gfargo/doorman (scoped)
- Primary binary is now `doorman`, `vercel-doorman` shows deprecation warning
- Updated all CLI help text, error messages, and documentation
- Updated GitHub URLs to gfargo/doorman (pending repo rename)
- Updated schema descriptions and constants
- Renamed skills directory from vercel-doorman to doorman
- All 57 test suites pass (1154 tests)

# [2.2.0](https://github.com/gfargo/doorman/compare/v2.1.0...v2.2.0) (2026-08-16)


### Bug Fixes

* **deps:** patch vulnerable transitive deps blocking the release pipeline ([5d704c9](https://github.com/gfargo/doorman/commit/5d704c94209b77af4572c95b08e203ac4d7d85f5))
* **init:** fix invalid security-focused template rule ([9518954](https://github.com/gfargo/doorman/commit/9518954d714543dfabba624f94533b142fd63b02))
* **prompts:** prevent crash and wrong defaults in interactive prompts ([c1a02d9](https://github.com/gfargo/doorman/commit/c1a02d9dd825e1774d2f46942b46fcf668f13b6c))
* update repository URL to match the renamed GitHub repo ([b18e3b2](https://github.com/gfargo/doorman/commit/b18e3b28d983deffa87d80aae93d2f77f5be665e))


### Features

* add sync/download/list/validate demos via a local mock API ([2ef3884](https://github.com/gfargo/doorman/commit/2ef3884f8d6fa124a372212796badc79e5cec59d))
* add VHS-recorded demo GIFs to README ([c23f6cf](https://github.com/gfargo/doorman/commit/c23f6cfeaa5dd22439f074aa0db51512431954e8))

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

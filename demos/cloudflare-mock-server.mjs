#!/usr/bin/env node
// Minimal local stand-in for Cloudflare's Ruleset Engine API
// (https://api.cloudflare.com/client/v4/zones/{zoneId}/rulesets), used only
// for demo/VHS capture and end-to-end verification purposes (see
// DOORMAN_CLOUDFLARE_API_BASE_URL in src/lib/providers/cloudflare/CloudflareClient.ts).
// Never used against real traffic.
//
// Models the {success, errors, messages, result} envelope every
// CloudflareClient method expects (see CloudflareAPIResponse in
// src/lib/types/cloudflare.ts), and the "rules live nested inside a ruleset,
// written via a full-ruleset PUT" shape doorman actually relies on
// (CloudflareFirewallService.syncRules calls getOrCreateFirewallRuleset then
// a single updateRuleset with the complete rules array) — not a per-rule
// POST/PATCH convention like fastly-mock-server.mjs or mock-server.mjs.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : fallback
}

const port = Number(getArg('port', '4762'))
const fixturePath = getArg('fixture')

if (!fixturePath) {
  console.error('Usage: cloudflare-mock-server.mjs --port <port> --fixture <path-to-json>')
  process.exit(1)
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const zoneId = fixture.zoneId ?? 'zone_demo'

const state = {
  rulesets: fixture.rulesets ?? [],
}

let rulesetIdCounter = state.rulesets.length

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const envelope = (result, overrides = {}) => ({
    success: true,
    errors: [],
    messages: [],
    result,
    ...overrides,
  })

  const url = new URL(req.url, `http://localhost:${port}`)
  const rulesetsPrefix = `/zones/${zoneId}/rulesets`

  try {
    // Rulesets collection
    if (url.pathname === rulesetsPrefix) {
      if (req.method === 'GET') {
        return send(200, envelope(state.rulesets))
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        rulesetIdCounter += 1
        const ruleset = {
          id: `ruleset_${rulesetIdCounter}`,
          name: body.name,
          description: body.description ?? '',
          kind: body.kind,
          phase: body.phase,
          version: '1',
          rules: body.rules ?? [],
        }
        state.rulesets.push(ruleset)
        return send(200, envelope(ruleset))
      }
      return send(405, envelope(null, { success: false, errors: [{ code: 405, message: 'method not allowed' }] }))
    }

    // Ruleset item
    if (url.pathname.startsWith(`${rulesetsPrefix}/`)) {
      const rulesetId = url.pathname.slice(rulesetsPrefix.length + 1)
      const index = state.rulesets.findIndex((r) => r.id === rulesetId)

      if (index === -1) {
        return send(404, envelope(null, { success: false, errors: [{ code: 404, message: 'ruleset not found' }] }))
      }

      if (req.method === 'GET') {
        return send(200, envelope(state.rulesets[index]))
      }
      if (req.method === 'PUT') {
        const body = await readBody(req)
        const current = state.rulesets[index]
        const updated = {
          ...current,
          ...body,
          id: rulesetId,
          version: String(Number(current.version) + 1),
        }
        state.rulesets[index] = updated
        return send(200, envelope(updated))
      }
      return send(405, envelope(null, { success: false, errors: [{ code: 405, message: 'method not allowed' }] }))
    }

    return send(404, envelope(null, { success: false, errors: [{ code: 404, message: 'not found' }] }))
  } catch (error) {
    return send(500, envelope(null, { success: false, errors: [{ code: 500, message: String(error) }] }))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`cloudflare-mock-server listening on 127.0.0.1:${port} (fixture: ${fixturePath})`)
})

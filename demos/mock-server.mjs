#!/usr/bin/env node
// Minimal local stand-in for the Vercel Firewall Config API, used only for
// demo/VHS capture purposes (see DOORMAN_VERCEL_API_BASE_URL in
// src/lib/services/VercelClient.ts). Never used against real traffic.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : fallback
}

const port = Number(getArg('port', '4747'))
const fixturePath = getArg('fixture')

if (!fixturePath) {
  console.error('Usage: mock-server.mjs --port <port> --fixture <path-to-json>')
  process.exit(1)
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))

const state = {
  version: fixture.version ?? 1,
  id: 'fw_demo',
  firewallEnabled: true,
  crs: {},
  rules: fixture.rules ?? [],
  ips: fixture.ips ?? [],
  projectKey: 'demo',
  ownerId: 'demo',
  updatedAt: fixture.updatedAt ?? '2026-01-15T12:00:00.000Z',
}

let idCounter = 0
const nextId = (prefix) => `${prefix}_${++idCounter}`

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

  const url = new URL(req.url, `http://localhost:${port}`)
  if (!url.pathname.startsWith('/v1/security/firewall/config')) {
    return send(404, { error: 'not found' })
  }

  try {
    if (req.method === 'GET') {
      return send(200, { active: state })
    }

    if (req.method === 'PUT') {
      const body = await readBody(req)
      state.rules = body.rules ?? []
      state.ips = body.ips ?? []
      state.version += 1
      return send(200, { active: state })
    }

    if (req.method === 'PATCH') {
      const { action, id, value } = await readBody(req)

      switch (action) {
        case 'rules.insert': {
          const newId = nextId('rule')
          state.rules.push({ id: newId, ...value })
          return send(200, { id: newId, ...value })
        }
        case 'rules.update': {
          state.rules = state.rules.map((r) => (r.id === id ? { ...r, ...value } : r))
          return send(200, { id, ...value })
        }
        case 'rules.remove': {
          state.rules = state.rules.filter((r) => r.id !== id)
          return send(200, {})
        }
        case 'ip.insert': {
          const newId = nextId('ip')
          state.ips.push({ id: newId, ...value })
          return send(200, { id: newId, ...value })
        }
        case 'ip.update': {
          state.ips = state.ips.map((r) => (r.id === id ? { ...r, ...value } : r))
          return send(200, { id, ...value })
        }
        case 'ip.remove': {
          state.ips = state.ips.filter((r) => r.id !== id)
          return send(200, {})
        }
        default:
          return send(400, { error: `unknown action: ${action}` })
      }
    }

    return send(405, { error: 'method not allowed' })
  } catch (error) {
    return send(500, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock-server listening on 127.0.0.1:${port} (fixture: ${fixturePath})`)
})

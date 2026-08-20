#!/usr/bin/env node
// Minimal local stand-in for Fastly's Next-Gen WAF API
// (https://api.fastly.com/ngwaf/v1/...), used only for demo/VHS capture and
// end-to-end verification purposes (see DOORMAN_FASTLY_API_BASE_URL in
// src/lib/providers/fastly/FastlyClient.ts). Never used against real traffic.
//
// Models the real REST shape confirmed against Fastly's official Go SDK
// (go-fastly's `ngwaf/v1/rules`/`ngwaf/v1/lists` packages) — normal REST
// verbs per resource, no PATCH-with-action-string convention like
// mock-server.mjs's Vercel emulation, and no draft/publish step (Next-Gen
// WAF rule writes take effect immediately).
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : fallback
}

const port = Number(getArg('port', '4748'))
const fixturePath = getArg('fixture')

if (!fixturePath) {
  console.error('Usage: fastly-mock-server.mjs --port <port> --fixture <path-to-json>')
  process.exit(1)
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const workspaceId = fixture.workspaceId ?? 'workspace_demo'

const state = {
  workspace: {
    id: workspaceId,
    name: fixture.workspaceName ?? 'Demo Workspace',
    description: '',
    mode: 'block',
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-15T12:00:00.000Z',
  },
  rules: fixture.rules ?? [],
  lists: fixture.lists ?? [],
}

let ruleIdCounter = state.rules.length
let listIdCounter = state.lists.length
const nextId = (prefix, counter) => `${prefix}_${++counter}`

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
  const rulesPrefix = `/ngwaf/v1/workspaces/${workspaceId}/rules`
  const listsPrefix = `/ngwaf/v1/workspaces/${workspaceId}/lists`
  const workspacePath = `/ngwaf/v1/workspaces/${workspaceId}`

  try {
    // Workspace (used by FastlyClient.verifyCredentials/fetchWorkspace)
    if (url.pathname === workspacePath && req.method === 'GET') {
      return send(200, state.workspace)
    }

    // Rules collection
    if (url.pathname === rulesPrefix) {
      if (req.method === 'GET') {
        return send(200, { data: state.rules, meta: { limit: 100, total: state.rules.length } })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const id = nextId('rule', ruleIdCounter)
        ruleIdCounter += 1
        const rule = {
          id,
          type: body.type,
          scope: { type: 'workspace', applies_to: [workspaceId] },
          enabled: body.enabled ?? false,
          description: body.description ?? '',
          group_operator: body.group_operator ?? 'all',
          request_logging: body.request_logging ?? 'sampled',
          conditions: body.conditions ?? [],
          actions: body.actions ?? [],
          rate_limit: body.rate_limit ?? null,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        }
        state.rules.push(rule)
        return send(201, rule)
      }
      return send(405, { msg: 'method not allowed' })
    }

    // Rule item
    if (url.pathname.startsWith(`${rulesPrefix}/`)) {
      const ruleId = url.pathname.slice(rulesPrefix.length + 1)
      const index = state.rules.findIndex((r) => r.id === ruleId)

      if (req.method === 'PATCH') {
        if (index === -1) return send(404, { msg: 'rule not found' })
        const body = await readBody(req)
        state.rules[index] = { ...state.rules[index], ...body, id: ruleId, updated_at: new Date(0).toISOString() }
        return send(200, state.rules[index])
      }
      if (req.method === 'DELETE') {
        if (index === -1) return send(404, { msg: 'rule not found' })
        state.rules.splice(index, 1)
        return send(204, {})
      }
      return send(405, { msg: 'method not allowed' })
    }

    // Lists collection
    if (url.pathname === listsPrefix) {
      if (req.method === 'GET') {
        return send(200, { data: state.lists, meta: { total: state.lists.length } })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const id = nextId('list', listIdCounter)
        listIdCounter += 1
        const list = {
          id,
          name: body.name,
          description: body.description ?? '',
          type: body.type,
          entries: body.entries ?? [],
          reference_id: '',
          scope: { type: 'workspace' },
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        }
        state.lists.push(list)
        return send(201, list)
      }
      return send(405, { msg: 'method not allowed' })
    }

    // List item
    if (url.pathname.startsWith(`${listsPrefix}/`)) {
      const listId = url.pathname.slice(listsPrefix.length + 1)
      const index = state.lists.findIndex((l) => l.id === listId)

      if (req.method === 'PATCH') {
        if (index === -1) return send(404, { msg: 'list not found' })
        const body = await readBody(req)
        state.lists[index] = { ...state.lists[index], ...body, id: listId, updated_at: new Date(0).toISOString() }
        return send(200, state.lists[index])
      }
      return send(405, { msg: 'method not allowed' })
    }

    return send(404, { msg: 'not found' })
  } catch (error) {
    return send(500, { msg: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`fastly-mock-server listening on 127.0.0.1:${port} (fixture: ${fixturePath})`)
})

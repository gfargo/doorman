#!/usr/bin/env node
// Minimal local stand-in for Google Cloud Armor's `securityPolicies` REST API
// (https://compute.googleapis.com/compute/v1/projects/{project}/global/securityPolicies/...),
// used for demo/VHS capture and exercising CloudArmorClient's request shapes
// end-to-end (see DOORMAN_GCP_API_BASE_URL in
// src/lib/providers/gcp/CloudArmorClient.ts). Never used against real traffic.
//
// Models the real REST shape confirmed against the Compute v1 API reference:
// addRule/patchRule/removeRule are POST (patchRule/removeRule address the
// target rule via a `?priority=` query param, not a path segment — there is
// no per-rule resource path the way Fastly/Vercel have one), and every
// mutator returns a long-running Operation rather than the updated resource,
// which CloudArmorClient polls via GET .../operations/{name}. This mock
// always reports an operation as immediately DONE — there's no async
// processing to actually wait on locally.
//
// One real limitation, unlike the Vercel/Cloudflare/Fastly mock servers:
// GoogleAuth's token flow (service-account JWT exchanged for an OAuth2
// access token at Google's real oauth2.googleapis.com) requires reaching
// Google's real infrastructure with real, working credentials — there's no
// way to fake that locally the way a static bearer token can be. This mock
// server exercises CloudArmorClient's request/response handling once a
// caller already has a real, working GoogleAuth setup; it cannot provide a
// fully offline end-to-end path the way the other three providers' mock
// servers can.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : fallback
}

const port = Number(getArg('port', '4867'))
const fixturePath = getArg('fixture')

if (!fixturePath) {
  console.error('Usage: cloudarmor-mock-server.mjs --port <port> --fixture <path-to-json>')
  process.exit(1)
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const projectId = fixture.projectId ?? 'demo-project'
const policyName = fixture.policyName ?? 'doorman-demo-policy'

const state = {
  policy: {
    id: fixture.policyId ?? '1234567890',
    name: policyName,
    description: fixture.policyDescription ?? 'Managed by doorman',
    rules: fixture.rules ?? [],
    fingerprint: 'ZmluZ2VycHJpbnQ=',
    selfLink: `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/securityPolicies/${policyName}`,
    creationTimestamp: '2026-01-15T12:00:00.000-08:00',
  },
}

let operationCounter = 0

async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

/** Every mutator returns this shape — CloudArmorClient.waitForOperation sees status DONE on the very first poll. */
function doneOperation() {
  operationCounter += 1
  return {
    kind: 'compute#operation',
    name: `operation-${operationCounter}`,
    status: 'DONE',
    progress: 100,
  }
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const url = new URL(req.url, `http://localhost:${port}`)
  const policyPath = `/projects/${projectId}/global/securityPolicies/${policyName}`

  try {
    // getPolicy
    if (url.pathname === policyPath && req.method === 'GET') {
      return send(200, state.policy)
    }

    // addRule — priority lives in the request body, not the URL
    if (url.pathname === `${policyPath}/addRule` && req.method === 'POST') {
      const rule = await readBody(req)
      if (state.policy.rules.some((r) => r.priority === rule.priority)) {
        return send(400, { error: { code: 400, message: `priority ${rule.priority} already in use` } })
      }
      state.policy.rules.push(rule)
      return send(200, doneOperation())
    }

    // patchRule — target rule addressed by ?priority=, replaces it wholesale
    if (url.pathname === `${policyPath}/patchRule` && req.method === 'POST') {
      const priority = Number(url.searchParams.get('priority'))
      const index = state.policy.rules.findIndex((r) => r.priority === priority)
      if (index === -1) {
        return send(404, { error: { code: 404, message: `no rule at priority ${priority}` } })
      }
      const rule = await readBody(req)
      state.policy.rules[index] = rule
      return send(200, doneOperation())
    }

    // removeRule — same addressing as patchRule, no body
    if (url.pathname === `${policyPath}/removeRule` && req.method === 'POST') {
      const priority = Number(url.searchParams.get('priority'))
      state.policy.rules = state.policy.rules.filter((r) => r.priority !== priority)
      return send(200, doneOperation())
    }

    // Operation polling — always already DONE by the time CloudArmorClient asks.
    if (url.pathname.startsWith(`/projects/${projectId}/global/operations/`) && req.method === 'GET') {
      const name = url.pathname.slice(`/projects/${projectId}/global/operations/`.length)
      return send(200, { kind: 'compute#operation', name, status: 'DONE', progress: 100 })
    }

    return send(404, { error: { code: 404, message: 'not found' } })
  } catch (error) {
    return send(500, { error: { code: 500, message: error instanceof Error ? error.message : String(error) } })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`cloudarmor-mock-server listening on 127.0.0.1:${port} (fixture: ${fixturePath})`)
})

# Document Lifecycle Demo

An original portfolio demonstration of a versioned document workflow. It uses synthetic data and has no connection to an employer's systems or documents.

## What it demonstrates

The demo addresses document-platform priorities in the [GoodLeap Senior Software Engineer, Documents posting](https://www.goodleap.com/careers/dd012f26-f493-4b10-9bfa-235f13f5309a): document generation (validated templates and versions), signing callbacks (HMAC-verified webhook), lifecycle accuracy (explicit transitions and audit entries), and reliable event handling (idempotency and out-of-order delivery). It does not demonstrate AWS scale, legal compliance, React, DocuSign, or production deployment. It is portfolio work, separate from employment experience.

## Run

Requires Node.js 20 or newer and no external packages.

```bash
npm test
npm run demo
WEBHOOK_SECRET=demo-secret npm start
```

Create a packet:

```bash
curl -s http://localhost:3000/packets -H 'content-type: application/json' -d '{"templateId":"agreement","templateVersion":1,"template":"Hello {{name}}","fields":{"name":"Sample Person"},"requestKey":"demo-1"}'
```

The response includes a packet ID. `GET /packets/:id` returns its current state and audit entries. `POST /webhooks/signature` accepts a JSON body containing `packetId`, `state`, and `eventId` plus an `x-demo-signature` HMAC-SHA256 header. Allowed progress is `draft → sent → signed → vaulted`, with `sent → declined` as an alternative.

`npm run demo` runs the whole flow without a server, API keys, or personal information. Example output (the packet ID and audit timestamps are intentionally omitted):

```json
{
  "renderedContent": "Hello Sample Person, reference DEMO-001.",
  "finalState": "vaulted",
  "auditStates": ["draft", "sent", "signed", "vaulted"]
}
```

The test suite covers missing fields, malformed requests, idempotency key reuse with changed content, tampered signatures, duplicate event IDs, conflicting outcomes, and signed/vaulted callbacks received before the sent callback.

## Scope and limits

- In-memory store only; restart clears packets.
- The rendered content is plain text, not a legally binding document.
- The webhook signature is a demonstration mechanism, not a real provider integration.
- Pending out-of-order events are held only in memory; production use would need durable storage, expiry, and reconciliation.
- No real customer information, private employer code, or third-party API keys are included.

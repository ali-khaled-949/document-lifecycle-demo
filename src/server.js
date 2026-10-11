import { createServer } from 'node:http';
import { DocumentStore, verifySignature } from './lifecycle.js';

const store = new DocumentStore();
const secret = process.env.WEBHOOK_SECRET;
const port = Number(process.env.PORT ?? 3000);
if (!secret) throw new Error('Set WEBHOOK_SECRET before starting the server');

function reply(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'POST' && url.pathname === '/packets') {
      const input = JSON.parse(await body(req));
      return reply(res, 201, store.create(input));
    }
    const match = url.pathname.match(/^\/packets\/([a-f0-9-]+)$/);
    if (req.method === 'GET' && match) {
      const packet = store.get(match[1]);
      return reply(res, packet ? 200 : 404, packet ?? { error: 'Packet not found' });
    }
    if (req.method === 'POST' && url.pathname === '/webhooks/signature') {
      const raw = await body(req);
      if (!verifySignature(raw, req.headers['x-demo-signature'], secret)) {
        return reply(res, 401, { error: 'Invalid signature' });
      }
      const { packetId, state, eventId } = JSON.parse(raw);
      if (!['sent', 'signed', 'declined', 'vaulted'].includes(state)) {
        return reply(res, 400, { error: 'Unsupported state' });
      }
      return reply(res, 200, store.advance(packetId, state, 'signed-webhook', eventId));
    }
    return reply(res, 404, { error: 'Route not found' });
  } catch (error) {
    return reply(res, 400, { error: error.message });
  }
}).listen(port, () => console.log(`Document demo listening on http://localhost:${port}`));

import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore, renderTemplate, signPayload, verifySignature } from '../src/lifecycle.js';

const input = {
  templateId: 'agreement', templateVersion: 2,
  template: 'Hello {{name}}, your reference is {{reference}}.',
  fields: { name: 'Sample Person', reference: 'DEMO-001' },
  requestKey: 'request-1',
};

test('renders only supplied synthetic fields and rejects missing values', () => {
  assert.equal(renderTemplate(input.template, input.fields), 'Hello Sample Person, your reference is DEMO-001.');
  assert.throws(() => renderTemplate(input.template, { name: 'Sample Person' }), /reference/);
});

test('create and webhook events are idempotent with an auditable transition history', () => {
  const store = new DocumentStore();
  const packet = store.create(input);
  assert.equal(store.create(input).id, packet.id);
  store.advance(packet.id, 'sent', 'signed-webhook', 'event-1');
  store.advance(packet.id, 'sent', 'signed-webhook', 'event-1');
  store.advance(packet.id, 'signed', 'signed-webhook', 'event-2');
  store.advance(packet.id, 'vaulted', 'signed-webhook', 'event-3');
  assert.deepEqual(packet.audit.map((entry) => entry.state), ['draft', 'sent', 'signed', 'vaulted']);
  assert.equal(packet.revision, 4);
  assert.throws(() => store.advance(packet.id, 'sent', 'signed-webhook', 'event-4'), /Invalid transition/);
});

test('out-of-order signed and vaulted events wait for their prerequisites', () => {
  const store = new DocumentStore();
  const packet = store.create(input);
  store.advance(packet.id, 'vaulted', 'signed-webhook', 'event-vault');
  store.advance(packet.id, 'signed', 'signed-webhook', 'event-sign');
  store.advance(packet.id, 'signed', 'signed-webhook', 'event-sign-again');
  assert.equal(packet.state, 'draft');
  store.advance(packet.id, 'sent', 'signed-webhook', 'event-send');
  assert.deepEqual(packet.audit.map((entry) => entry.state), ['draft', 'sent', 'signed', 'vaulted']);
  store.advance(packet.id, 'signed', 'signed-webhook', 'event-sign');
  assert.equal(packet.audit.length, 4);
});

test('rejects contradictory event reuse and incompatible final outcomes', () => {
  const store = new DocumentStore();
  const packet = store.create(input);
  store.advance(packet.id, 'signed', 'signed-webhook', 'event-sign');
  assert.throws(() => store.advance(packet.id, 'declined', 'signed-webhook', 'event-decline'), /Conflicting/);
  assert.throws(() => store.advance(packet.id, 'vaulted', 'signed-webhook', 'event-sign'), /Event ID reused/);
  assert.throws(() => store.advance(packet.id, 'draft', 'signed-webhook', 'event-rewind'), /Invalid transition/);
});

test('rejects malformed creation requests', () => {
  const store = new DocumentStore();
  assert.throws(() => store.create({ ...input, requestKey: '' }), /requestKey/);
  assert.throws(() => store.create({ ...input, templateVersion: 0 }), /positive version/);
  store.create(input);
  assert.throws(() => store.create({ ...input, templateVersion: 3 }), /Request key reused/);
});

test('webhook signature rejects tampered payloads', () => {
  const secret = 'demo-secret';
  const raw = JSON.stringify({ packetId: '123', state: 'signed', eventId: 'e1' });
  const signature = signPayload(raw, secret);
  assert.equal(verifySignature(raw, signature, secret), true);
  assert.equal(verifySignature(raw.replace('signed', 'declined'), signature, secret), false);
  assert.equal(verifySignature(raw, 'bad', secret), false);
});

import { DocumentStore } from '../src/lifecycle.js';

const store = new DocumentStore();
const packet = store.create({
  templateId: 'sample-agreement',
  templateVersion: 1,
  template: 'Hello {{name}}, reference {{reference}}.',
  fields: { name: 'Sample Person', reference: 'DEMO-001' },
  requestKey: 'demo-request',
});

// Simulate delivery arriving out of order and one repeated event.
store.advance(packet.id, 'signed', 'demo-webhook', 'event-signed');
store.advance(packet.id, 'sent', 'demo-webhook', 'event-sent');
store.advance(packet.id, 'signed', 'demo-webhook', 'event-signed');
store.advance(packet.id, 'vaulted', 'demo-webhook', 'event-vaulted');

console.log(JSON.stringify({
  renderedContent: packet.content,
  finalState: packet.state,
  auditStates: packet.audit.map(({ state }) => state),
}, null, 2));

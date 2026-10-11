import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const transitions = {
  draft: new Set(['sent']),
  sent: new Set(['signed', 'declined']),
  signed: new Set(['vaulted']),
  declined: new Set(),
  vaulted: new Set(),
};

const futureStates = {
  draft: new Set(['sent', 'signed', 'declined', 'vaulted']),
  sent: new Set(['signed', 'declined', 'vaulted']),
  signed: new Set(['vaulted']),
  declined: new Set(),
  vaulted: new Set(),
};

export function renderTemplate(template, fields) {
  const keys = [...template.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((match) => match[1]);
  const missing = [...new Set(keys)].filter((key) => typeof fields[key] !== 'string' || !fields[key].trim());
  if (missing.length) throw new Error(`Missing template fields: ${missing.join(', ')}`);
  return template.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, key) => fields[key]);
}

export function signPayload(rawBody, secret) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(rawBody, signature, secret) {
  if (!/^[a-f0-9]{64}$/i.test(signature ?? '')) return false;
  const expected = Buffer.from(signPayload(rawBody, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  return timingSafeEqual(expected, received);
}

export class DocumentStore {
  constructor() {
    this.packets = new Map();
    this.requests = new Map();
    this.events = new Map();
    this.pending = new Map();
  }

  create({ templateId, templateVersion, template, fields, requestKey }) {
    if (!requestKey) throw new Error('requestKey is required');
    const digest = createHash('sha256').update(JSON.stringify({ templateId, templateVersion, template, fields })).digest('hex');
    const previous = this.requests.get(requestKey);
    if (previous) {
      if (previous.digest !== digest) throw new Error('Request key reused with different data');
      return this.packets.get(previous.id);
    }
    if (!templateId || !Number.isInteger(templateVersion) || templateVersion < 1) {
      throw new Error('A template ID and positive version are required');
    }
    const content = renderTemplate(template, fields);
    const packet = {
      id: randomUUID(), templateId, templateVersion, content,
      state: 'draft', revision: 0, audit: [],
    };
    this.packets.set(packet.id, packet);
    this.requests.set(requestKey, { id: packet.id, digest });
    this.#advance(packet, 'created', 'draft');
    return packet;
  }

  get(id) { return this.packets.get(id); }

  advance(id, nextState, actor, eventId) {
    const packet = this.packets.get(id);
    if (!packet) throw new Error('Packet not found');
    if (!eventId) throw new Error('eventId is required');
    if (!['sent', 'signed', 'declined', 'vaulted'].includes(nextState)) {
      throw new Error(`Invalid transition: ${packet.state} -> ${nextState}`);
    }
    const previous = this.events.get(eventId);
    if (previous) {
      if (previous.packetId !== id || previous.state !== nextState) {
        throw new Error('Event ID reused with different data');
      }
      return packet;
    }
    if (packet.state === nextState || (this.pending.get(id) ?? []).some((event) => event.state === nextState)) {
      this.events.set(eventId, { packetId: id, state: nextState });
      return packet;
    }
    if (!futureStates[packet.state].has(nextState)) {
      throw new Error(`Invalid transition: ${packet.state} -> ${nextState}`);
    }
    const queued = this.pending.get(id) ?? [];
    const hasDecline = queued.some((event) => event.state === 'declined');
    const hasSign = queued.some((event) => event.state === 'signed' || event.state === 'vaulted');
    if ((nextState === 'declined' && hasSign) || (nextState !== 'declined' && nextState !== 'sent' && hasDecline)) {
      throw new Error('Conflicting pending outcome');
    }
    this.events.set(eventId, { packetId: id, state: nextState });
    queued.push({ state: nextState, actor, eventId });
    this.pending.set(id, queued);
    this.#drain(packet);
    return packet;
  }

  #drain(packet) {
    const queued = this.pending.get(packet.id);
    let changed = true;
    while (changed) {
      changed = false;
      const index = queued.findIndex((event) => transitions[packet.state].has(event.state));
      if (index >= 0) {
        const [event] = queued.splice(index, 1);
        this.#advance(packet, event.actor, event.state);
        for (let i = queued.length - 1; i >= 0; i--) {
          if (queued[i].state === packet.state) queued.splice(i, 1);
        }
        changed = true;
      }
    }
    if (queued.length === 0) this.pending.delete(packet.id);
  }

  #advance(packet, actor, state) {
    packet.state = state;
    packet.revision += 1;
    packet.audit.push({ revision: packet.revision, actor, state, at: new Date().toISOString() });
  }
}

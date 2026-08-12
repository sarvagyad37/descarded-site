/* STUB STORE — in-memory, resets whenever the Worker isolate recycles.
   Swap for real persistence (KV / D1 / an ESP) before launch. Not part of
   this pass — see decision log: no backend provider chosen yet. */

const subscribers = new Map(); // email -> { email, source, createdAt }
const submissions = [];        // artist submissions

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function addSubscriber({ email, source }) {
  const key = normalizeEmail(email);
  if (subscribers.has(key)) return { code: 'already', subscriber: subscribers.get(key) };
  const subscriber = { email: key, source: source || 'site', createdAt: new Date().toISOString() };
  subscribers.set(key, subscriber);
  return { code: 'new', subscriber };
}

export function addSubmission(entry) {
  const ref = 'DSC-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const record = Object.assign({ ref, createdAt: new Date().toISOString() }, entry);
  submissions.push(record);
  return record;
}

export function stats() {
  return { subscribers: subscribers.size, submissions: submissions.length };
}

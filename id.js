/**
 * JAPT ids - new ids for records, created in the app.
 *
 * crypto.randomUUID only exists on https and on localhost. Opened over the local network
 * (http://192.168.…), the browser doesn't offer it, so this falls back to getRandomValues,
 * which works everywhere and gives the same kind of id (a random UUID, version 4).
 */

function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

if (typeof module !== "undefined") module.exports = newId;

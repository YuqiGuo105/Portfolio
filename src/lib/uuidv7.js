/**
 * Minimal UUIDv7 generator (RFC 9562).
 * Format: 48-bit unix_ts_ms | 4-bit version(7) | 12-bit rand_a | 2-bit variant | 62-bit rand_b
 * No external dependency; uses crypto.getRandomValues via Node's built-in.
 */

import { randomBytes } from 'crypto';

export function uuidv7() {
  const now = Date.now(); // 48-bit ms timestamp

  const buf = randomBytes(10); // 80 random bits

  // --- timestamp (48 bits) → 6 bytes big-endian ---
  const hi32 = Math.floor(now / 0x100000000); // top 16 bits of 48
  const lo32 = now >>> 0;                      // bottom 32 bits of 48

  // Build as 16-byte hex string:
  const ts = [
    ((now / 0x10000000000) & 0xff) >>> 0,  // byte 0
    ((now / 0x100000000)   & 0xff) >>> 0,  // byte 1
    ((now / 0x1000000)     & 0xff) >>> 0,  // byte 2
    ((now / 0x10000)       & 0xff) >>> 0,  // byte 3
    ((now / 0x100)         & 0xff) >>> 0,  // byte 4
    ( now                  & 0xff) >>> 0,  // byte 5
  ];

  // byte 6 = 0x70 | rand_a[0..3]
  const b6 = 0x70 | (buf[0] & 0x0f);
  // byte 7 = rand_a[4..11]
  const b7 = buf[1];
  // byte 8 = 0x80 | rand_b[0..5]
  const b8 = 0x80 | (buf[2] & 0x3f);
  // bytes 9..15 = rand_b[6..62] (7 bytes)
  const rest = buf.slice(3, 10);

  const hex = [
    ...ts,
    b6, b7, b8,
    ...rest,
  ].map(b => b.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

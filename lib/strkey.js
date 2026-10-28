'use strict';
// Stellar/Pi StrKey validation: base32 payload + version byte + CRC16-XModem.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of s) {
    const n = ALPHABET.indexOf(ch);
    if (n < 0) throw new Error('invalid base32');
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); }
  }
  if (bits && (value & ((1 << bits) - 1)) !== 0) throw new Error('invalid base32 padding');
  return Buffer.from(out);
}
function crc16xmodem(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
function isValidAccountId(id) {
  if (typeof id !== 'string') return false;
  const s = id.trim();
  // G... is a public account key (35-byte payload); M... is a muxed account (also accepted).
  if (!/^G[A-Z2-7]{55}$/.test(s) && !/^M[A-Z2-7]{68}$/.test(s)) return false;
  try {
    const decoded = decodeBase32(s);
    if (decoded.length < 3) return false;
    const body = decoded.subarray(0, -2);
    const checksum = decoded.readUInt16LE(decoded.length - 2);
    const version = body[0];
    const expectedVersion = s[0] === 'G' ? 6 << 3 : 12 << 3;
    return version === expectedVersion && checksum === crc16xmodem(body);
  } catch { return false; }
}
module.exports = { isValidAccountId, decodeBase32, crc16xmodem };

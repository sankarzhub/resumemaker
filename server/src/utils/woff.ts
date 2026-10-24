import zlib from 'node:zlib';

/**
 * Convert a WOFF 1.0 font to a plain TrueType/OpenType (sfnt) buffer.
 * pdfkit can read WOFF directly, but it re-inflates every table for every document it creates;
 * converting once at startup makes each PDF render several times faster.
 */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') return woff; // already sfnt (or unknown): pass through
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables: Array<{ tag: string; checksum: number; data: Buffer }> = [];
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = woff.toString('latin1', e, e + 4);
    const offset = woff.readUInt32BE(e + 4);
    const compLength = woff.readUInt32BE(e + 8);
    const origLength = woff.readUInt32BE(e + 12);
    const checksum = woff.readUInt32BE(e + 16);
    const raw = woff.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw) });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const pow = 2 ** Math.floor(Math.log2(numTables));
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(pow * 16, 6);
  header.writeUInt16BE(Math.log2(pow), 8);
  header.writeUInt16BE(numTables * 16 - pow * 16, 10);

  const bodies: Buffer[] = [];
  let offset = header.length;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    header.write(t.tag, r, 4, 'latin1');
    header.writeUInt32BE(t.checksum, r + 4);
    header.writeUInt32BE(offset, r + 8);
    header.writeUInt32BE(t.data.length, r + 12);
    const padded = Buffer.alloc((t.data.length + 3) & ~3);
    t.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

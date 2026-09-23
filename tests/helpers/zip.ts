import { crc32, deflateRawSync } from 'node:zlib';
export interface ZipEntry {
  name: string;
  content?: string | Buffer;
  mode?: number;
  extra?: Buffer;
  deflate?: boolean;
  declaredSize?: number;
  checksum?: number;
}
export function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const filename = Buffer.from(entry.name),
      content = Buffer.from(entry.content ?? ''),
      compressed = entry.deflate ? deflateRawSync(content) : content;
    const extra = entry.extra ?? Buffer.alloc(0),
      size = entry.declaredSize ?? content.length,
      checksum = entry.checksum ?? crc32(content),
      method = entry.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(
      ((entry.mode ?? (entry.name.endsWith('/') ? 0o40755 : 0o100644)) << 16) >>> 0,
      38,
    );
    central.writeUInt32LE(offset, 42);
    const part = Buffer.concat([local, filename, extra, compressed]);
    locals.push(part);
    centrals.push(Buffer.concat([central, filename, extra]));
    offset += part.length;
  }
  const central = Buffer.concat(centrals),
    footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(central.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, footer]);
}

'use strict';
// Reads .tar.gz and .zip archives entirely in memory.
// Nothing is ever written to disk and nothing is ever executed.
const zlib = require('zlib');

const DEFAULT_LIMITS = {
  maxFiles: 8000,               // entries
  maxTotal: 120 * 1024 * 1024,  // total unpacked bytes
  maxFile: 3 * 1024 * 1024,     // bytes kept per file for scanning
};

class ArchiveError extends Error {
  constructor(msg) { super(msg); this.userFacing = true; }
}

function cleanPath(p) {
  const raw = String(p).replace(/\\/g, '/');
  const parts = raw.split('/');
  const traversal = raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || parts.includes('..');
  return { path: parts.filter(x => x && x !== '.' && x !== '..').join('/'), traversal };
}

function cstr(buf, start, len) {
  const s = buf.subarray(start, start + len);
  const z = s.indexOf(0);
  return (z === -1 ? s : s.subarray(0, z)).toString('utf8');
}

function parseOctal(b) {
  if (b[0] & 0x80) throw new ArchiveError('Archive uses an unsupported size format.');
  const s = cstr(b, 0, b.length).trim();
  return s ? parseInt(s, 8) : 0;
}

function parsePax(data) {
  const out = {};
  let s = data.toString('utf8');
  while (s.length) {
    const sp = s.indexOf(' ');
    if (sp < 1) break;
    const len = parseInt(s.slice(0, sp), 10);
    if (!len) break;
    const rec = s.slice(sp + 1, len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    s = s.slice(len);
  }
  return out;
}

function tooBig() { return new ArchiveError('That project is too big to scan here (over 120 MB unpacked).'); }

function makeEntry(rawPath, extra) {
  const { path, traversal } = cleanPath(rawPath);
  return Object.assign({ path, rawPath, traversal }, extra);
}

function readTarGz(buf, limits = {}) {
  const lim = Object.assign({}, DEFAULT_LIMITS, limits);
  let tar;
  try {
    tar = zlib.gunzipSync(buf, { maxOutputLength: lim.maxTotal + 1024 * 1024 });
  } catch (e) {
    if (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) throw tooBig();
    throw new ArchiveError('Could not unpack that archive.');
  }
  const files = [];
  let off = 0, longName = null, paxPath = null, count = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h[0] === 0 && h.every(x => x === 0)) break;
    const name = cstr(h, 0, 100);
    const size = parseOctal(h.subarray(124, 136));
    const type = h[156] ? String.fromCharCode(h[156]) : '0';
    const link = cstr(h, 157, 100);
    const magic = cstr(h, 257, 6);
    const prefix = magic.startsWith('ustar') ? cstr(h, 345, 155) : '';
    const start = off + 512, end = start + size;
    if (end > tar.length) throw new ArchiveError('That archive is cut off or damaged.');
    const data = tar.subarray(start, end);
    off = start + Math.ceil(size / 512) * 512;

    if (type === 'x') { paxPath = parsePax(data).path || null; continue; }
    if (type === 'g') continue;
    if (type === 'L') { longName = cstr(data, 0, data.length); continue; }
    if (type === 'K') continue;

    const full = paxPath || longName || (prefix ? prefix + '/' + name : name);
    paxPath = longName = null;
    if (type === '5') continue;
    if (++count > lim.maxFiles) throw new ArchiveError(`That project has more than ${lim.maxFiles} files, which is too many to scan here.`);

    if (type === '1' || type === '2') {
      files.push(makeEntry(full, { kind: 'symlink', linkTarget: link, size: 0, data: Buffer.alloc(0) }));
    } else if (type === '0' || type === '7') {
      files.push(makeEntry(full, {
        kind: 'file', size,
        data: size > lim.maxFile ? data.subarray(0, lim.maxFile) : data,
        truncated: size > lim.maxFile,
      }));
    } else {
      files.push(makeEntry(full, { kind: 'other', size: 0, data: Buffer.alloc(0) }));
    }
  }
  return files;
}

function inflateCapped(comp, max) {
  try {
    return { data: zlib.inflateRawSync(comp, { maxOutputLength: max }), truncated: false };
  } catch (e) {
    if (!(e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) throw e;
  }
  // Too big to keep whole: take the start of it only.
  try {
    const part = zlib.inflateRawSync(comp.subarray(0, 64 * 1024), {
      finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: max,
    });
    return { data: part.subarray(0, max), truncated: true };
  } catch (e) {
    return { data: Buffer.alloc(0), truncated: true, bomb: true };
  }
}

function readZip(buf, limits = {}) {
  const lim = Object.assign({}, DEFAULT_LIMITS, limits);
  if (buf.length < 22) throw new ArchiveError('That file is not a valid zip.');
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 65557); i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ArchiveError('That file is not a valid zip.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new ArchiveError('Very large (zip64) archives are not supported.');
  if (count > lim.maxFiles) throw new ArchiveError(`That zip has more than ${lim.maxFiles} files, which is too many to scan here.`);

  const files = [];
  let p = cdOff, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ArchiveError('That zip is damaged.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const loff = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    if (rawName.endsWith('/')) continue;

    if (loff + 30 > buf.length || buf.readUInt32LE(loff) !== 0x04034b50) throw new ArchiveError('That zip is damaged.');
    const ds = loff + 30 + buf.readUInt16LE(loff + 26) + buf.readUInt16LE(loff + 28);
    if (ds + csize > buf.length) throw new ArchiveError('That zip is cut off or damaged.');
    const comp = buf.subarray(ds, ds + csize);
    const isLink = ((ext >>> 16) & 0xF000) === 0xA000;

    if (flags & 1) {
      files.push(makeEntry(rawName, { kind: 'encrypted', size: usize, data: Buffer.alloc(0) }));
      continue;
    }
    let data, truncated = false, bomb = false;
    if (method === 0) {
      data = comp.length > lim.maxFile ? comp.subarray(0, lim.maxFile) : comp;
      truncated = comp.length > lim.maxFile;
    } else if (method === 8) {
      const r = inflateCapped(comp, lim.maxFile);
      data = r.data; truncated = r.truncated; bomb = !!r.bomb;
    } else {
      files.push(makeEntry(rawName, { kind: 'other', size: usize, data: Buffer.alloc(0), note: `compression method ${method}` }));
      continue;
    }
    total += Math.min(usize, lim.maxFile);
    if (total > lim.maxTotal) throw tooBig();
    if (isLink) {
      files.push(makeEntry(rawName, { kind: 'symlink', linkTarget: data.toString('utf8').slice(0, 300), size: 0, data: Buffer.alloc(0) }));
    } else {
      files.push(makeEntry(rawName, {
        kind: 'file', size: usize, data, truncated, bomb,
        ratio: csize ? usize / csize : 0,
      }));
    }
  }
  return stripCommonRoot(files);
}

// "my-test-main/src/app.js" -> "src/app.js" when everything sits in one folder.
function stripCommonRoot(files) {
  if (files.length < 2) return files;
  const first = files[0].path.split('/')[0];
  if (!files.every(f => f.path.includes('/') && f.path.split('/')[0] === first)) return files;
  for (const f of files) f.path = f.path.slice(first.length + 1);
  return files;
}

module.exports = { readTarGz, readZip, stripCommonRoot, ArchiveError, DEFAULT_LIMITS };

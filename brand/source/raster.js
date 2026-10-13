// Hash Block: PNG, ICO and the Tauri icon set. Everything derives from dist/svg,
// which derives from build.py. Nothing here is a source of truth.
// Order: python build.py -> node raster.js -> python board.py -> node raster.js board
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs'), path = require('path');
const SRC = 'dist/svg';
const read = f => fs.readFileSync(path.join(SRC, f + '.svg'), 'utf8');
const render = (src, w) => Buffer.from(new Resvg(read(src), { fitTo: { mode: 'width', value: w } }).render().asPng());

if (process.argv[2] === 'board') {
  for (const f of ['hshblk-brand-board', 'hshblk-in-context']) {
    if (!fs.existsSync(f + '.svg')) continue;
    const r = new Resvg(fs.readFileSync(f + '.svg', 'utf8'), { imageRendering: 1 });
    fs.writeFileSync(f + '.png', r.render().asPng());
    console.log('wrote', f + '.png');
  }
  process.exit(0);
}

const OUT = 'dist/png';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const made = [];
const png = (name, src, w) => { const b = render(src, w); fs.writeFileSync(path.join(OUT, name), b); made.push(name); return b; };

// below 24 px the mark is the 16 px drawing; from 24 up, the master
for (const s of [24, 32, 48, 64, 128, 256, 512, 1024]) {
  png(`mark-${s}.png`, 'mark', s);
  png(`mark-dark-${s}.png`, 'mark-dark', s);
}
png('mark-16.png', 'favicon-16', 16);
png('mark-dark-16.png', 'favicon-16-dark', 16);
png('favicon-32.png', 'favicon-16', 32);           // the 16 grid doubled is exact at 32
png('favicon-dark-32.png', 'favicon-16-dark', 32);
for (const s of [180, 192, 512, 1024]) { png(`icon-${s}.png`, 'icon', s); png(`icon-dark-${s}.png`, 'icon-dark', s); }
png('icon-macos-1024.png', 'icon-macos', 1024);
for (const f of ['glyph', 'glyph-dark', 'glyph-black', 'glyph-white', 'mark-black', 'mark-white']) png(`${f}-512.png`, f, 512);
for (const f of ['wordmark', 'wordmark-dark', 'wordmark-black', 'wordmark-white']) png(`${f}-1200.png`, f, 1200);
for (const f of ['stack', 'stack-dark']) png(`${f}-800.png`, f, 800);
for (const f of ['readme-banner', 'readme-banner-dark']) png(`${f}.png`, f, 1280);
for (const f of ['og-image', 'og-image-dark']) png(`${f}.png`, f, 1200);
for (const f of ['social-preview', 'social-preview-dark']) png(`${f}.png`, f, 1280);

// ICO: PNG-compressed entries. 16 is the pixel-fitted drawing; the rest are the master.
function ico(file, entries) {
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(entries.length, 4);
  let off = dir.length;
  entries.forEach(([s, buf], i) => {
    const e = 6 + i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(buf.length, e + 8); dir.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  fs.writeFileSync(file, Buffer.concat([dir, ...entries.map(([, b]) => b)]));
}
fs.mkdirSync('dist/ico', { recursive: true });
ico('dist/ico/favicon.ico', [[16, render('favicon-16', 16)], [32, render('favicon-16', 32)], [48, render('mark', 48)]]);

// The Tauri set, file for file what desktop/src-tauri/icons ships today. Windows'
// icon.ico carries the 16 px drawing, which `tauri icon` would resample from 1024.
const T = 'dist/tauri';
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
fs.writeFileSync(path.join(T, '32x32.png'), render('favicon-16', 32));
fs.writeFileSync(path.join(T, '128x128.png'), render('icon', 128));
fs.writeFileSync(path.join(T, '128x128@2x.png'), render('icon', 256));
fs.writeFileSync(path.join(T, 'icon.png'), render('icon', 512));
ico(path.join(T, 'icon.ico'), [[16, render('favicon-16', 16)], [24, render('mark', 24)], [32, render('favicon-16', 32)],
  [48, render('mark', 48)], [64, render('mark', 64)], [256, render('icon', 256)]]);
// icns, PNG-bearing types only: icp4 16, icp5 32, ic11 16@2x, ic12 32@2x, ic07 128,
// ic13 128@2x, ic08 256, ic14 256@2x, ic09 512, ic10 512@2x. 16 and 32 are the 16 px
// drawing full-bleed: Apple's grid would leave a 13 px body, too small for the gap.
const icnsTypes = [['icp4', 'favicon-16', 16], ['icp5', 'favicon-16', 32], ['ic11', 'favicon-16', 32], ['ic12', 'icon-macos', 64],
  ['ic07', 'icon-macos', 128], ['ic13', 'icon-macos', 256], ['ic08', 'icon-macos', 256], ['ic14', 'icon-macos', 512],
  ['ic09', 'icon-macos', 512], ['ic10', 'icon-macos', 1024]];
const chunks = icnsTypes.map(([t, src, s]) => {
  const data = render(src, s), head = Buffer.alloc(8);
  head.write(t, 0, 'ascii'); head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const body = Buffer.concat(chunks), top = Buffer.alloc(8);
top.write('icns', 0, 'ascii'); top.writeUInt32BE(body.length + 8, 4);
fs.writeFileSync(path.join(T, 'icon.icns'), Buffer.concat([top, body]));

console.log(`${made.length} png -> ${OUT}; favicon.ico; tauri set -> ${T}`);

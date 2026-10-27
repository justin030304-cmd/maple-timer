import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'public', 'ocr');
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const english = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

// Copy only integrity-checked npm package assets; never fetch an OCR CDN at runtime.
await mkdir(output, { recursive: true });
await copyFile(join(tesseract, 'dist', 'worker.min.js'), join(output, 'worker.min.js'));
const coreAssets = (await readdir(core)).filter(name => /^tesseract-core(?:-[a-z]+)*\.wasm(?:\.js)?$/.test(name));
for (const name of coreAssets) await copyFile(join(core, name), join(output, name));
await copyFile(join(english, '4.0.0_best_int', 'eng.traineddata.gz'), join(output, 'eng.traineddata.gz'));
await copyFile(join(core, 'LICENSE'), join(output, 'TESSERACT-LICENSE.txt'));
await copyFile(join(tesseract, 'LICENSE.md'), join(output, 'TESSERACT-JS-LICENSE.md'));
const bytes = (await Promise.all((await readdir(output)).map(name => stat(join(output, name))))).reduce((total, file) => total + file.size, 0);
console.log(`Prepared local OCR assets: ${coreAssets.length} core files, worker, English model (${(bytes / 1024 / 1024).toFixed(1)} MiB).`);

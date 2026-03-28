import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');
const bundledHoldemSrc = path.resolve(serverRoot, 'apps', 'games', 'holdem-tournament', 'src');
const repoHoldemSrc = path.resolve(repoRoot, 'apps', 'games', 'holdem-tournament', 'src');
const holdemSrc = fs.existsSync(bundledHoldemSrc) ? bundledHoldemSrc : repoHoldemSrc;
const entry = path.resolve(serverRoot, 'src', 'holdem-online', 'shared', 'engine-entry.ts');
const outfile = path.resolve(serverRoot, 'src', 'holdem-online', 'shared', 'holdem-engine.generated.js');

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: {
    holdem: holdemSrc,
  },
  logLevel: 'info',
});

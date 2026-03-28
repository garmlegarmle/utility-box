import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const holdemSrc = path.resolve(repoRoot, 'apps', 'games', 'holdem-tournament', 'src');
const entry = path.resolve(repoRoot, 'server', 'src', 'holdem-online', 'shared', 'engine-entry.ts');
const outfile = path.resolve(repoRoot, 'server', 'src', 'holdem-online', 'shared', 'holdem-engine.generated.js');

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

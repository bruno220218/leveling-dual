import fs from 'node:fs';
import path from 'node:path';

const SYSTEMS = ['windows', 'macos', 'linux', 'android'];
const out = {};
for (const arg of process.argv.slice(2)) {
  const [system, version] = arg.split('=');
  if (!SYSTEMS.includes(system) || !/^\d+\.\d+\.\d+$/.test(version || '')) {
    console.error(`Ignorado: "${arg}". Use sistema=1.2.3 (sistemas: ${SYSTEMS.join(', ')}).`);
    process.exitCode = 1;
    continue;
  }
  out[system] = version;
}
if (!Object.keys(out).length) {
  console.error('Nada para gravar. Exemplo: node scripts/versoes.mjs windows=1.4.0 linux=1.4.1');
  process.exit(1);
}
const file = path.join(process.cwd(), 'release', 'versoes.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`Gravado ${file}:`);
console.log(JSON.stringify(out, null, 2));
console.log('Anexe esse arquivo na release do GitHub, junto com os downloads.');

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function sources(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory()
      ? sources(`${directory}/${entry.name}`)
      : /\.(?:js|mjs)$/.test(entry.name) ? [`${directory}/${entry.name}`] : [])
    .sort();
}

const files = ['dist', 'tests', 'scripts'].flatMap(sources);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax checked: ${files.length} JavaScript files`);

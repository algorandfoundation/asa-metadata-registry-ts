// Marks each build's module format, so Node loads `dist/esm` as ES modules and `dist/cjs` as
// CommonJS, whatever the root package.json declares.
import { writeFileSync } from 'node:fs'
import { URL } from 'node:url'

for (const [dir, type] of [
  ['esm', 'module'],
  ['cjs', 'commonjs'],
]) {
  writeFileSync(new URL(`../dist/${dir}/package.json`, import.meta.url), `${JSON.stringify({ type }, null, 2)}\n`)
}

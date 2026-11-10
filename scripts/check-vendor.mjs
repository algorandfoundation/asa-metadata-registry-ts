// Verify vendored noble-hashes files against the pinned npm devDependency.
import { readdirSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { URL } from 'node:url'

const root = new URL('../', import.meta.url)
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'))

// The vendored folder, the package it copies, and where each file is in that package
const dir = 'src/internal/vendor/noble-hashes/'
const pkg = '@noble/hashes'
const upstreamPath = (file) => (file === 'LICENSE' ? file : `src/${file}`)

const spec = readJson(new URL('package.json', root)).devDependencies?.[pkg]
if (!/^\d+\.\d+\.\d+$/.test(spec ?? '')) {
  throw new Error(`${pkg} must be an exact devDependency such as "2.4.0", got ${JSON.stringify(spec)}`)
}

// Read the package by path: its `exports` map exposes neither package.json nor src/
const pkgDir = new URL(`node_modules/${pkg}/`, root)
const { version } = readJson(new URL('package.json', pkgDir))
if (version !== spec) {
  throw new Error(`node_modules has ${pkg} ${version}, but package.json pins ${spec}: run pnpm install`)
}

const entries = readdirSync(new URL(dir, root), { withFileTypes: true })
for (const file of ['sha2.ts', '_md.ts', '_u64.ts', 'utils.ts', 'LICENSE']) {
  if (!entries.some((entry) => entry.name === file)) throw new Error(`${dir}${file} is missing`)
}
for (const entry of entries) {
  if (!entry.isFile()) throw new Error(`${dir}${entry.name} is not a file`)
  let expected
  try {
    expected = readFileSync(new URL(upstreamPath(entry.name), pkgDir))
  } catch {
    throw new Error(`${dir}${entry.name} has no counterpart ${upstreamPath(entry.name)} in ${pkg} ${version}`)
  }
  if (!readFileSync(new URL(`${dir}${entry.name}`, root)).equals(expected)) {
    throw new Error(
      `${dir}${entry.name} differs from ${upstreamPath(entry.name)} in ${pkg} ${version}. ` +
        `Copy it from node_modules/${pkg}/ (see CONTRIBUTING.md).`,
    )
  }
}
process.stdout.write(`${dir}: ${entries.length} files match ${pkg} ${version}\n`)

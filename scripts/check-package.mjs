// Imports the built package by its own name, as an ESM and a CommonJS consumer would, so the
// `exports` map, the dist module markers and the ESM import specifiers are all exercised.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import { URL } from 'node:url'

const { name } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const esm = await import(name)
const cjs = createRequire(import.meta.url)(name)

const exportNames = (module) => Object.keys(module).filter((key) => key !== 'default' && key !== 'module.exports')
const esmNames = exportNames(esm).sort()
const cjsNames = exportNames(cjs).sort()

if (esmNames.length === 0 || esmNames.join() !== cjsNames.join()) {
  throw new Error(`ESM and CommonJS builds export different names (${esmNames.length} vs ${cjsNames.length})`)
}
process.stdout.write(`${name}: ESM and CommonJS builds load with the same ${esmNames.length} exports\n`)

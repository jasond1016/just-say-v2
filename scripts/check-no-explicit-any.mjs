#!/usr/bin/env node
/**
 * Fails if src/ contains explicit `any` usages (: any, as any, <any>, Promise<any>, etc.).
 * Allows vitest expect.any(...).
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const patterns = [
  String.raw`:\s*any\b`,
  String.raw`as\s+any\b`,
  String.raw`<any>`,
  String.raw`\bany\[\]`,
  String.raw`Promise<\s*any\s*>`,
  String.raw`Array<\s*any\s*>`,
  String.raw`Record<\s*[^,]+,\s*any\s*>`
]

let output = ''
try {
  output = execSync(
    `git grep -n -E "${patterns.join('|')}" -- "src/**/*.ts" "src/**/*.tsx"`,
    { cwd: root, encoding: 'utf8' }
  )
} catch (error) {
  const err = /** @type {{ status?: number, stderr?: string, message?: string }} */ (error)
  if (err.status === 1) {
    console.log('OK: no explicit any in src/')
    process.exit(0)
  }
  console.error(err.stderr || err.message)
  process.exit(err.status ?? 1)
}

const hits = output
  .split('\n')
  .filter(Boolean)
  .filter((line) => !line.includes('expect.any('))

if (hits.length === 0) {
  console.log('OK: no explicit any in src/')
  process.exit(0)
}

console.error('FAIL: explicit any found:')
for (const hit of hits) {
  console.error(`  ${hit}`)
}
process.exit(1)

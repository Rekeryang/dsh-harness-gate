/** 语法自检：不需要 Node 之外的任何依赖。 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const files = ['index.js', 'lib/route.js', 'lib/injections.js', 'runtime/gate.js']

let failed = 0
for (const rel of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' })
    console.log(`OK   ${rel}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${rel}`)
    console.error(String(error.stderr || error.message))
  }
}
if (failed) process.exit(1)
console.log('All JavaScript files parse cleanly.')

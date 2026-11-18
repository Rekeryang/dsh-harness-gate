/** 仓库自检：结构、资源、无本地存储、注入契约。零第三方依赖。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildInjectionRows } from '../lib/injections.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(root, rel))
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

// structure
for (const f of ['index.js', 'package.json', 'cordis.patch.yml', 'runtime/gate.css', 'runtime/gate.js', 'README.md', 'LICENSE']) {
  check(`file ${f}`, exists(f))
}
for (const f of [
  'vision_bundle.js', 'face_landmarker.task',
  'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm',
  'wasm/vision_wasm_module_internal.js', 'wasm/vision_wasm_module_internal.wasm',
]) {
  check(`vendor ${f}`, exists('vendor/' + f))
}

// privacy: no persistent storage
const gate = read('runtime/gate.js')
check('no localStorage/sessionStorage writes', !/localStorage\.(setItem|removeItem)|sessionStorage\.(setItem|removeItem)/.test(gate))
check('template kept in memory', /var template = null/.test(gate))

// injection contract: style before script, only kind:'script', no script-src
const css = read('runtime/gate.css')
const rows = buildInjectionRows({ clientConfig: { version: 'test' }, cssText: css, jsText: gate })
check('two injection rows', rows.length === 2)
check('style row first', rows[0]?.kind === 'style')
check('script row second', rows[1]?.kind === 'script' && rows[1]?.placement === 'body')
check('no script-src kind', !rows.some((r) => r.kind === 'script-src'))
check('css scoped to #dshg-root', css.includes('#dshg-root'))

// no sensitive placeholder data
check('no masked PII placeholder', !/XENO-0X7A|138\d{8}/.test(gate + css))

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')

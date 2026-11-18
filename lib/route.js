/**
 * 纯逻辑：HTTP 边界辅助函数。零依赖，不 import 任何 DSH 包。
 */
import path from 'node:path'

/** 解析 HTTP Range 头；返回闭区间 / null(整份) / 'unsatisfiable'(416)。 */
export function parseRange(header, size) {
  if (header === undefined || header === null || header === '') return null
  if (typeof header !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim())
  if (match === null) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null
  let start, end
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (!Number.isFinite(size) || size <= 0) return 'unsatisfiable'
  if (start > end || start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/** 扩展名 → MIME。 */
export function contentTypeFor(fileName) {
  return CONTENT_TYPES[path.extname(String(fileName)).toLowerCase()] ?? 'application/octet-stream'
}

/** 把包内相对路径解析成绝对路径，并保证没有逃出包目录。 */
export function resolveInsidePackage(packageRoot, relativePath) {
  const root = path.resolve(packageRoot)
  const target = path.resolve(root, String(relativePath))
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`asset path escapes the package directory: ${String(relativePath)}`)
  }
  return target
}

/** 把值安全地嵌进内联 <script> 文本的 JSON 字面量。 */
export function toInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029')
}

/** @param {unknown} value */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

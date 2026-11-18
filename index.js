/**
 * dsh-harness-gate —— 宿主半边。
 *
 * 三件事：
 *   ① 给 webserver/index-inject 贡献两行（style + script），在页面加载时把
 *      DEEPSEEK HARNESS 生物识别门禁覆盖层挂到 body 上；
 *   ② 用带 Range 的路由把 vendor 资源（vision_bundle.js / wasm / .task 模型）供浏览器读取；
 *   ③ 全程零 DSH 包 import，只用 node: 内建，任何一步失败都只 warn，绝不影响 DSH 启动。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildInjectionRows } from './lib/injections.js'
import { contentTypeFor, parseRange, resolveInsidePackage } from './lib/route.js'

/** Cordis 诊断用的插件名。 */
export const name = 'harness-gate'

/** 无必需服务：webServer 用 ctx.inject 迟到接入，不阻塞 apply。 */
export const inject = []

/** 所有路由共享前缀。 */
export const ROUTE_PREFIX = '/dsh-harness-gate'
/** vendor 静态资源通配前缀（vision_bundle.js / wasm/* / face_landmarker.task）。 */
export const ASSET_ROUTE = `${ROUTE_PREFIX}/asset`
/** 运行期配置。 */
export const CONFIG_ROUTE = `${ROUTE_PREFIX}/config.json`
/** 与 package.json 一致。 */
export const VERSION = '0.1.0'

const RUNTIME_DIR = 'runtime'
const VENDOR_DIR = 'vendor'

/** vendor 文件清单（相对 vendor/ 目录）。 */
const FILES = Object.freeze({
  bundle: 'vision_bundle.js',
  model: 'face_landmarker.task',
  wasmJs: 'wasm/vision_wasm_internal.js',
  wasmBin: 'wasm/vision_wasm_internal.wasm',
  wasmModuleJs: 'wasm/vision_wasm_module_internal.js',
  wasmModuleBin: 'wasm/vision_wasm_module_internal.wasm',
})

/** 客户端配置：告诉运行时去哪里取资源。 */
const CLIENT_CONFIG = Object.freeze({
  version: VERSION,
  assetBase: `${ASSET_ROUTE}/`,
  configUrl: CONFIG_ROUTE,
  files: FILES,
})

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 按 mtime+size 缓存的文本读取器（桌面壳只在启动时收集一次注入表）。 */
function makeRuntimeReader(packageRoot) {
  const cache = new Map()
  return (file) => {
    const target = path.join(packageRoot, RUNTIME_DIR, file)
    const stat = fs.statSync(target)
    const hit = cache.get(file)
    if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.text
    const text = fs.readFileSync(target, 'utf8')
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text })
    return text
  }
}

/** 按 HTTP 语义把文件发给浏览器（ETag + Range + HEAD）。 */
function serveAsset(req, res, filePath) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('asset not found')
    return
  }
  const size = stat.size
  const etag = `"${size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`
  const range = parseRange(req.headers.range, size)
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
    res.end()
    return
  }
  /** @type {Record<string, string | number>} */
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Accept-Ranges': 'bytes',
    ETag: etag,
  }
  if (range !== null) {
    headers['Cache-Control'] = 'no-store'
    headers['Content-Length'] = range.end - range.start + 1
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    res.writeHead(206, headers)
    if (req.method === 'HEAD') { res.end(); return }
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }
  headers['Cache-Control'] = 'no-cache'
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers); res.end(); return
  }
  headers['Content-Length'] = size
  res.writeHead(200, headers)
  if (req.method === 'HEAD') { res.end(); return }
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

/**
 * 插件主体。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const packageRoot = fileURLToPath(new URL('.', import.meta.url))
  const readRuntime = makeRuntimeReader(packageRoot)

  const warn = (message) => {
    try { ctx.logger?.warn?.(`[${name}] ${message}`) } catch { /* 日志不该成为失败原因 */ }
  }

  // ── ① 注入行：同步注册，不等任何服务 ──
  ctx.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table)) return
    try {
      const rows = buildInjectionRows({
        clientConfig: CLIENT_CONFIG,
        cssText: readRuntime('gate.css'),
        jsText: readRuntime('gate.js'),
      })
      table.push(...rows)
    } catch (error) {
      warn(`注入行生成失败，门禁将不显示：${describe(error)}`)
    }
  })

  // ── ② 路由：webServer 迟到接入 ──
  ctx.inject(['webServer'], (child) => {
    child.effect(() => {
      /** @type {Array<() => void>} */
      const disposers = []

      // 配置
      disposers.push(
        child.webServer.register({
          kind: 'exact',
          path: CONFIG_ROUTE,
          handler: (req, res) => {
            const payload = JSON.stringify(CLIENT_CONFIG)
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': Buffer.byteLength(payload),
              'Cache-Control': 'no-store',
            })
            res.end(payload)
          },
        }),
      )

      // vendor 静态资源：逐个精确注册（只用 kind:'exact'，与宿主已验证的插件一致）。
      // wasm 目录本身也要注册：FilesetResolver 会请求 <wasm>/vision_wasm_internal.js 等。
      const ASSET_FILES = [
        FILES.bundle, FILES.model,
        FILES.wasmJs, FILES.wasmBin,
        FILES.wasmModuleJs, FILES.wasmModuleBin,
      ]
      for (const rel of ASSET_FILES) {
        const route = `${ASSET_ROUTE}/${rel}`
        let filePath
        try {
          filePath = resolveInsidePackage(path.join(packageRoot, VENDOR_DIR), rel)
        } catch (error) {
          warn(`资源路径逃逸被拒绝：${describe(error)}`)
          continue
        }
        disposers.push(
          child.webServer.register({
            kind: 'exact',
            path: route,
            handler: (req, res) => serveAsset(req, res, filePath),
          }),
        )
      }

      return () => disposers.forEach((dispose) => { try { dispose() } catch { /* noop */ } })
    })
  })
}

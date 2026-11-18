/**
 * 结构化索引注入行（webserver/index-inject 贡献）。
 *
 * 硬约束（来自 DSH 页面侧解释器）：
 *   ① 行按数组顺序应用 → style 必须在 script 之前。
 *   ② 只用 kind:'script'（createElement+textContent+append，无 await，不可能失败）；
 *      绝不用 kind:'script-src'（失败会打掉 __DSH_BOOT_READY__ ⇒ 应用起不来）。
 *   ③ 覆盖层挂 document.body，不进 #root（避免 hydrateRoot 内容不匹配）。
 */
import { toInlineJson } from './route.js'

/** 页面侧读取部署期配置用的全局名。 */
export const BOOTSTRAP_GLOBAL = '__DSH_HARNESS_GATE__'

/**
 * @param {{ clientConfig: Record<string, unknown>, cssText: string, jsText: string }} input
 * @returns {Array<Record<string, unknown>>}
 */
export function buildInjectionRows(input) {
  const bootstrap = `globalThis.${BOOTSTRAP_GLOBAL}=${toInlineJson(input.clientConfig)};`
  return [
    { kind: 'style', text: input.cssText },
    { kind: 'script', placement: 'body', text: `${bootstrap}\n${input.jsText}` },
  ]
}

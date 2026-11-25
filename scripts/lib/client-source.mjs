import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

/**
 * 客户端产物的唯一构建入口。
 *
 * `client.js` 不是手写文件，而是 esbuild 把 `client/` 这组 ES 模块打成一份
 * CommonJS 包、再套上 DSH 的 `__ModuleLoader__.load` 外框后生成的分发产物。
 * 构建脚本和一致性校验都必须走这里，避免「谁构建的」和「谁校验的」两份实现漂移。
 */
export const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const clientEntry = join(projectRoot, 'client', 'index.js')
export const clientBundlePath = join(projectRoot, 'client.js')

/**
 * 递归拼接 `client/` 下的作者态源码。
 *
 * 源码级断言（i18n 键引用、主题属性、UI 缩放写法）读这里；行为断言才在 vm 里跑
 * `client.js` 产物，因为产物被 esbuild 重排且剥掉注释，无法做文本匹配。
 */
export function readAuthoredClient({ includeLocales = false } = {}) {
  const collect = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return collect(path)
      return entry.name.endsWith('.js') ? [path] : []
    })
  return collect(join(projectRoot, 'client'))
    .filter((path) => includeLocales || !path.endsWith('locales.js'))
    .sort()
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
}

// 模块 id 必须与 package.json 的 name 一致（DSH 按包名注册模块），改名时
// 只改 package.json 即可，避免构建产物与清单再次漂移。
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const moduleId = typeof packageJson.name === 'string' && packageJson.name ? packageJson.name : 'dsh-ai-translation'

// 外框保持 DSH 侧契约不变：factory 收到 require，返回 entry 的默认导出。
const HEADER = `// 由 scripts/build-client.mjs 从 client/ 构建生成，请勿手工修改。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(moduleId)},
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    ;(function (module, exports, require) {
`

const FOOTER = `    })(module, exports, require)
    return module.exports.default || module.exports
  },
})
`

export async function buildClientSource() {
  const result = await build({
    entryPoints: [clientEntry],
    absWorkingDir: projectRoot,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    // React 由 DSH 客户端运行时通过 require 注入，不进产物。
    external: ['react'],
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
  })
  return `${HEADER}${result.outputFiles[0].text}${FOOTER}`
}

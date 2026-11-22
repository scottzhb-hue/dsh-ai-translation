export const MOCK_PROVIDER = 'mock'
export const MOCK_MODEL = 'cait-mock'
export const NO_ROUTE_MESSAGE = '未配置 DSH 模型路由，当前使用术语替换（离线）。'
export const NO_MODEL_MESSAGE = '所选 DSH 模型路由没有可用模型，当前使用术语替换（离线）。'

function service(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : ctx?.[name]
  } catch {
    return undefined
  }
}

function configuredProviderIds(loader) {
  const ids = new Set()
  try {
    for (const entry of loader?.entries?.() ?? []) {
      const providers = entry?.options?.config?.providers
      if (!providers || typeof providers !== 'object' || Array.isArray(providers)) continue
      for (const id of Object.keys(providers)) ids.add(id)
    }
  } catch {
    // Loader discovery is best-effort; the llm adapter catalog remains usable.
  }
  return ids
}

// Vision-wrapper routes (modlens mints `modlens-<upstream>` / `deepseek-modlens`)
// list their upstream's text models but resolve them through a bridge built for
// image evidence. A text-only call routed there can fail before it reaches the
// model, so CAIT keeps those routes listed yet prefers the real provider.
const VISION_WRAPPER_ID = /^(?:modlens-|deepseek-modlens$)/

export function isVisionWrapper(id, name) {
  return VISION_WRAPPER_ID.test(String(id ?? '')) || /\(modlens vision\)/i.test(String(name ?? ''))
}

function normalizeModels(catalog) {
  if (!Array.isArray(catalog)) return []
  const seen = new Set()
  const models = []
  for (const item of catalog) {
    const id = String(item?.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, name: String(item?.name ?? id).trim() || id })
  }
  return models
}

async function discoverRoutes(llm, loader) {
  if (!llm || typeof llm.listProviders !== 'function') {
    return { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
  }

  let adapters
  try {
    adapters = await llm.listProviders()
  } catch {
    adapters = []
  }
  if (!Array.isArray(adapters)) adapters = []

  const configured = configuredProviderIds(loader)
  const providers = []
  const seen = new Set()

  for (const adapter of adapters) {
    const id = String(adapter?.id ?? '').trim()
    if (!id || id === MOCK_PROVIDER || seen.has(id)) continue
    seen.add(id)

    let models = []
    if (typeof llm.listModels === 'function') {
      try {
        models = normalizeModels(await llm.listModels(id))
      } catch {
        models = []
      }
    }
    // Loader entries only tell us which providers already have a route
    // configured; they do not define the catalog. Providers may be registered
    // outside loader entries (the built-in DeepSeek adapter is one), so the
    // loader must never decide visibility: filtering on it made every such
    // adapter vanish as soon as a single custom provider was added.
    const name = String(adapter?.name ?? id).trim() || id
    providers.push({
      id,
      name,
      models,
      configured: configured.has(id),
      hasModels: models.length > 0,
      wrapper: isVisionWrapper(id, name),
    })
  }

  // Configured routes first, then real providers before vision wrappers, so a
  // freshly added wrapper never becomes the default pick for text translation.
  providers.sort(
    (a, b) =>
      Number(b.configured) - Number(a.configured) ||
      Number(Boolean(a.wrapper)) - Number(Boolean(b.wrapper)),
  )

  const usable = providers.filter((provider) => provider.hasModels)
  return {
    providers,
    fallback: usable.length === 0,
    message: usable.length ? '' : providers.length ? NO_MODEL_MESSAGE : NO_ROUTE_MESSAGE,
  }
}

// Wrap the host llm stream so every call can report the usage it received.
// The wrapper only observes: chunks are yielded unchanged, and a provider that
// never emits usage simply records nothing.
async function* withUsage(chunks, request, ledger) {
  let recorded = false
  try {
    for await (const chunk of chunks) {
      if (!recorded && chunk && typeof chunk === 'object') {
        const usage = chunk.usage || (chunk.type === 'finish' ? chunk.finish?.usage : null)
        if (usage && typeof usage === 'object') {
          try {
            const tokens = ledger.record({
              purpose: request?.purpose,
              provider: request?.provider,
              model: request?.model,
              usage,
            })
            if (tokens) recorded = true
          } catch {
            // Accounting must never break a translation.
          }
        }
      }
      yield chunk
    }
  } finally {
    // A consumer may stop at `finish`; flush so the RPC snapshot is current.
    try {
      ledger.flush?.()
    } catch {
      // ignore
    }
  }
}

export function createMtRuntime(ctx, options = {}) {
  const llm = service(ctx, 'llm')
  const loader = service(ctx, 'loader')
  const usage = options.usage ?? null
  let cached = null
  let cachedAt = 0

  async function listRoutes({ refresh = false } = {}) {
    if (!refresh && cached && Date.now() - cachedAt < 30_000) return cached
    cached = await discoverRoutes(llm, loader)
    cachedAt = Date.now()
    return cached
  }

  return {
    available: Boolean(llm && typeof llm.stream === 'function'),
    listRoutes,
    async stream(options) {
      if (!llm || typeof llm.stream !== 'function') {
        const error = new Error('DSH llm service is not available')
        error.code = 'LLM_UNAVAILABLE'
        throw error
      }
      const chunks = await llm.stream(options)
      return usage ? withUsage(chunks, options, usage) : chunks
    },
  }
}

export async function collectStreamText(chunks) {
  if (!chunks || typeof chunks[Symbol.asyncIterator] !== 'function') {
    const error = new Error('DSH 模型路由没有返回可迭代的流')
    error.code = 'MT_STREAM_INVALID'
    throw error
  }

  let text = ''
  let finish = null
  for await (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta') {
      text += String(chunk.text ?? '')
    } else if (chunk.type === 'finish') {
      finish = chunk
      break
    }
  }

  if (!finish) {
    const error = new Error('DSH 模型路由未返回完成事件')
    error.code = 'MT_STREAM_INCOMPLETE'
    throw error
  }

  const reason = finish.reason || {}
  if (reason.kind !== 'stop') {
    const failure = reason.failure || {}
    const error = new Error(failure.message || 'DSH 模型路由调用失败')
    error.code = failure.code || (reason.kind === 'aborted' ? 'MT_ABORTED' : 'MT_STREAM_FAILED')
    error.status = failure.status
    throw error
  }

  return text.trim()
}

import { MOCK_PROVIDER, NO_MODEL_MESSAGE, NO_ROUTE_MESSAGE, isVisionWrapper } from './mt.js'

/**
 * A vision wrapper (modlens) advertises its upstream's text models but routes
 * every call through a bridge meant for image evidence; a text-only request can
 * fail there before it reaches the model, and the failure looks like a broken
 * route. When the configured route turns out to be a wrapper, fall back to the
 * first real route that serves models, so translation keeps working.
 */
function pickRoute(providers, selectedRoute, wantedModel) {
  const models = Array.isArray(selectedRoute.models) ? selectedRoute.models : []
  const model = models.some((item) => item.id === wantedModel) ? wantedModel : models[0]?.id
  if (!isVisionWrapper(selectedRoute.id, selectedRoute.name)) {
    return { route: selectedRoute, model, skipped: '' }
  }
  const usable = providers.find(
    (route) => !isVisionWrapper(route.id, route.name) && Array.isArray(route.models) && route.models.length,
  )
  if (!usable) return { route: selectedRoute, model, skipped: '' }
  const next = usable.models.some((item) => item.id === wantedModel) ? wantedModel : usable.models[0].id
  return {
    route: usable,
    model: next,
    skipped: `已跳过识图包装路由 ${selectedRoute.name || selectedRoute.id}，改用 ${
      usable.name || usable.id
    }。`,
  }
}

/**
 * routes: part of the CatStore API, registered in lib/store-mixins.js.
 */
export const routeMethods = {
  async listMtRoutes(options = {}) {
    if (this.mtRuntime && typeof this.mtRuntime.listRoutes === 'function') {
      return this.mtRuntime.listRoutes(options)
    }
    return { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
  },

  /**
   * Resolve the configured DSH route once, so single and batch translation
   * share the same mock/fallback behaviour.
   */
  async resolveMtRoute() {
    const provider = this.settings.mt.provider
    let routes
    try {
      routes = await this.listMtRoutes()
    } catch {
      routes = { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
    }
    const providers = Array.isArray(routes?.providers) ? routes.providers : []
    if (provider === MOCK_PROVIDER) {
      return {
        mock: true,
        note: providers.length ? '术语替换（离线）：当前未调用 DSH 模型。' : NO_ROUTE_MESSAGE,
      }
    }
    const selectedRoute = providers.find((route) => route.id === provider)
    if (!selectedRoute) return { mock: true, note: NO_ROUTE_MESSAGE }
    const picked = pickRoute(providers, selectedRoute, this.settings.mt.model)
    if (!picked.model) return { mock: true, note: NO_MODEL_MESSAGE }
    return picked.skipped
      ? { mock: false, provider: picked.route.id, model: picked.model, note: picked.skipped }
      : { mock: false, provider: picked.route.id, model: picked.model }
  },

  /**
   * Review may intentionally use a different route than bulk MT. An empty
   * review provider inherits the MT route, which keeps old settings working.
   */
  async resolveReviewRoute() {
    const provider = String(this.settings.review?.provider || '').trim()
    if (!provider) {
      return { ...(await this.resolveMtRoute()), inherited: true }
    }
    let routes
    try {
      routes = await this.listMtRoutes()
    } catch {
      routes = { providers: [], fallback: true, message: NO_ROUTE_MESSAGE }
    }
    const providers = Array.isArray(routes?.providers) ? routes.providers : []
    if (provider === MOCK_PROVIDER) {
      return { mock: true, note: NO_ROUTE_MESSAGE, inherited: false }
    }
    const selectedRoute = providers.find((route) => route.id === provider)
    if (!selectedRoute) return { mock: true, note: NO_ROUTE_MESSAGE, inherited: false }
    const wanted = String(this.settings.review?.model || '').trim()
    const picked = pickRoute(providers, selectedRoute, wanted)
    if (!picked.model) return { mock: true, note: NO_MODEL_MESSAGE, inherited: false }
    return picked.skipped
      ? {
          mock: false,
          provider: picked.route.id,
          model: picked.model,
          inherited: false,
          note: picked.skipped,
        }
      : { mock: false, provider: picked.route.id, model: picked.model, inherited: false }
  },
}

// Token 计价的唯一来源。所有金额都换算自 DSH llm 流回传的 usage，属于「估算」：
// 拿不到实际扣费，也不含中国法定节假日的峰谷例外。
//
// 价格口径 = DeepSeek 官方定价（2026-09-22 复核）：元（美元）/ 百万 tokens，
// 分峰时与谷时两档，谷时 5 折。峰时 = 北京时间 09:00-12:00、14:00-18:00，
// 周一至周五（官方明确不含中国法定节假日）。
export const PRICING_SOURCE = 'deepseek-official'
export const PRICING_UPDATED_AT = '2026-09-22'

const RATES = {
  CNY: {
    peak: {
      'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
      'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    },
    offPeak: {
      'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    },
  },
  USD: {
    peak: {
      'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
      'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    },
    offPeak: {
      'deepseek-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 },
      'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
    },
  },
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 把任意模型名归到计费档。认不出来就返回 null —— 宁可显示「—」，
 * 也不拿别的档位凑一个看起来精确的假数字。
 */
export function classifyModel(model) {
  const name = String(model || '').toLowerCase()
  if (!name) return null
  if (/v4[-_. ]?pro|reasoner|(^|[-_/])pro($|[-_/])/.test(name)) return 'deepseek-v4-pro'
  if (/flash|chat|v4[-_. ]?flash/.test(name)) return 'deepseek-flash'
  return null
}

/** 北京时间的「峰时」判定。节假日不算谷时的口径无法离线得知，这里只按周末排除。 */
export function peakInfo(at = Date.now()) {
  const time = Number(at) || Date.now()
  const beijing = new Date(time + BEIJING_OFFSET_MS)
  const weekday = beijing.getUTCDay()
  const hour = beijing.getUTCHours() + beijing.getUTCMinutes() / 60
  const weekend = weekday === 0 || weekday === 6
  const inWindow = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
  return { peak: !weekend && inWindow, weekend, hour: Math.floor(hour) }
}

/**
 * 按一次调用的 usage 估算金额（单位：元 / 美元）。
 * cacheReadTokens 按缓存命中价，其余 input 按未命中价，output 按输出价。
 * 返回 null 表示模型认不出，调用方应显示「—」。
 */
export function estimateCost({ model, usage, at } = {}) {
  const tier = classifyModel(model)
  if (!tier || !usage) return null
  const cacheRead = Math.max(0, Number(usage.cacheReadTokens) || 0)
  const input = Math.max(0, Number(usage.inputTokens) || 0)
  const output = Math.max(0, Number(usage.outputTokens) || 0)
  const miss = Math.max(0, input - cacheRead)
  const { peak } = peakInfo(at)
  const band = peak ? 'peak' : 'offPeak'
  const cny = RATES.CNY[band][tier]
  const usd = RATES.USD[band][tier]
  const per = (rate) => (cacheRead * rate.cacheHit + miss * rate.cacheMiss + output * rate.output) / 1e6
  return { tier, peak, cny: per(cny), usd: per(usd) }
}

/** 当前生效的价目表快照，供客户端展示「按哪一版价格估算」。 */
export function pricingTable() {
  return { source: PRICING_SOURCE, updatedAt: PRICING_UPDATED_AT, currency: 'CNY', rates: RATES.CNY }
}

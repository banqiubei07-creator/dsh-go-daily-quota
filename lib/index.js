// 今日额度：输入框上方一条「今日¥0.97·余额¥1.57 谷时」。
// 数据来自 DeepSeek 余额接口：每天第一次读取时把当时的余额当基准，
// 之后余额的差值就是今天花掉的钱；余额本身直接显示。
// 峰谷按 DeepSeek 官方峰谷定价判断：北京时间周一至周五 9:00–12:00、14:00–18:00 为峰时，
// 其余时间（含周末全天）为谷时半价。法定节假日暂未单独判断。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'local-daily-quota'

const REFRESH_MS = 5 * 60 * 1000
const TICK_MS = 60 * 1000
const HOME = process.env.DSH_HOME?.trim() || '/root/.dsh'
const CREDENTIALS = join(HOME, '.credentials.yaml')
const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const STATE_FILE = join(STATE_DIR, 'state.json')

let last
let lastAt = 0

function apiKey() {
  try {
    const raw = readFileSync(CREDENTIALS, 'utf8')
    const match = raw.match(/DEEPSEEK_API_KEY:\s*"?([^"\s]+)"?/)
    return match?.[1]
  } catch {
    return undefined
  }
}

function dayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state))
  } catch { /* 写不进去就只影响跨天基准 */ }
}

async function balance() {
  const key = apiKey()
  if (key === undefined) throw new Error('no key')
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const body = await res.json()
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : []
  const cny = infos.find((item) => item.currency === 'CNY') ?? infos[0]
  const total = Number(cny?.total_balance)
  if (!Number.isFinite(total)) throw new Error('bad body')
  return total
}

/** 更新当天基准，返回今天的花费。基准取当天第一次读到的余额（或前一天最后读到的余额）。 */
function spentToday(total) {
  const state = loadState()
  const today = dayKey()
  if (state.day !== today) {
    const recent = Number.isFinite(state.at) && Date.now() - state.at < 36 * 3600 * 1000
    state.day = today
    state.base = recent && Number.isFinite(state.total) ? state.total : total
  }
  if (!Number.isFinite(state.base)) state.base = total
  if (total > state.base) state.base = total // 充值后不把充值金额算成负花费
  state.total = total
  state.at = Date.now()
  saveState(state)
  return Math.max(0, state.base - total)
}

/** 按北京时间判断是否高峰：周一至周五 9:00–12:00、14:00–18:00。 */
const BEIJING_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function isPeak(now = new Date()) {
  const parts = BEIJING_CLOCK.formatToParts(now)
  const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
  if (['Sat', 'Sun'].includes(value('weekday'))) return false
  const minutes = Number(value('hour')) * 60 + Number(value('minute'))
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

const emitters = new Set()

function render() {
  if (last === undefined) return
  const peak = isPeak()
  const text = `今日¥${last.spent.toFixed(2)}·余额¥${last.total.toFixed(2)} ${peak ? '峰时' : '谷时'}`
  for (const emit of emitters) {
    emit({ text, icon: 'coin', tone: peak ? 'warn' : 'good' })
  }
}

async function refresh() {
  let total
  try {
    total = await balance()
  } catch {
    for (const emit of emitters) emit({ text: '余额读取失败', icon: 'warning', tone: 'muted' })
    return
  }
  last = { total, spent: spentToday(total) }
  lastAt = Date.now()
  render()
}

function tick() {
  if (Date.now() - lastAt >= REFRESH_MS) void refresh()
  else render()
}

const timers = new Set()

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.strip('quota', (scope, emit) => {
      emitters.add(emit)
      if (last === undefined) emit({ text: '今日额度 读取中', icon: 'coin' })
      else render()
      if (timers.size === 0) {
        void refresh()
        timers.add(setInterval(tick, TICK_MS))
      }
      return () => {
        emitters.delete(emit)
        if (emitters.size === 0) {
          for (const timer of timers) clearInterval(timer)
          timers.clear()
        }
      }
    })

    ctx.dshGo.on('quota', (scope, event) => {
      const zh = !String(event.locale).startsWith('en')
      void refresh()
      if (last === undefined) return { toast: zh ? '还没读到余额，稍等一下' : 'Balance not loaded yet' }
      const period = isPeak()
        ? (zh ? '峰时 9–12、14–18 原价' : 'Peak 9–12, 14–18')
        : (zh ? '谷时 半价' : 'Off-peak half price')
      return {
        toast: zh
          ? `余额 ¥${last.total.toFixed(2)}｜今日 ¥${last.spent.toFixed(2)}｜${period}`
          : `Balance ¥${last.total.toFixed(2)}｜Today ¥${last.spent.toFixed(2)}｜${period}`,
      }
    })
  })
}

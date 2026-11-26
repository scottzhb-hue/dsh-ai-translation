import * as React from 'react'

const { Component, createElement } = React

/**
 * 插件级错误边界。
 *
 * 之前 `rememberInclude` 漏解构导致工作台首帧抛 ReferenceError，DSH 的错误
 * 边界把整个面板吞成空白，用户只看到「点了没反应」。这层边界把异常转成可
 * 读的错误块（含复制按钮），下次崩了能直接把堆栈贴出来。
 */
const CRASH_CSS = `
.cait-crash{display:flex;flex-direction:column;gap:10px;padding:18px;height:100%;overflow:auto;font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit}
.cait-crash-title{margin:0;font-size:14px;font-weight:700;color:#e5534b}
.cait-crash-hint{margin:0;opacity:.75}
.cait-crash-detail{margin:0;padding:10px;max-height:46vh;overflow:auto;font-family:ui-monospace,monospace;font-size:10.5px;white-space:pre-wrap;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:rgba(128,128,128,.1)}
.cait-crash .cait-modal-actions{display:flex;gap:8px;justify-content:flex-end}
.cait-crash .cait-btn{padding:5px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;cursor:pointer;font:inherit}
.cait-crash .cait-btn.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
`

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, stack: '' }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    const stack = String((error && error.stack) || error || '') + String(info?.componentStack || '')
    this.setState({ stack })
    console.error('[@scottzhb-hue/dsh-ai-translation] render failed', error, info)
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    const detail = stack || String(error?.message || error || '')
    return createElement(
      'div',
      { className: 'cait-crash' },
      createElement('style', null, CRASH_CSS),
      createElement('h2', { className: 'cait-crash-title' }, '工作台渲染出错 / Workbench crashed'),
      createElement(
        'p',
        { className: 'cait-crash-hint' },
        '可以先点「重试」；如果反复出现，请复制下面的错误信息反馈。 / Retry first; copy the details below if it keeps happening.',
      ),
      createElement('pre', { className: 'cait-crash-detail' }, detail),
      createElement(
        'div',
        { className: 'cait-modal-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'cait-btn',
            onClick: () => {
              try {
                void navigator.clipboard?.writeText(detail)
              } catch {
                /* clipboard is best-effort */
              }
            },
          },
          '复制错误 / Copy',
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'cait-btn primary',
            onClick: () => this.setState({ error: null, stack: '' }),
          },
          '重试 / Retry',
        ),
      ),
    )
  }
}

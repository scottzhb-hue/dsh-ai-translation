// 静态闸：用 eslint 的 no-undef 抓「引用了没声明的变量」这类会在浏览器里整窗白屏的低级错误。
// 只检查 client/ lib/ index.js；_dev/ 与 scripts/ 是测试与工具，不参与。
// 没装 devDependencies 时（例如刚装好的发布包）自动跳过，避免挡住安装。
import globals from 'globals'

let ESLint
try {
  ;({ ESLint } = await import('eslint'))
} catch {
  console.log('check-undef: eslint 未安装（缺少 devDependencies），跳过')
  process.exit(0)
}

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.js'],
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: {
          ...globals.browser,
          ...globals.node,
          ...globals.es2021,
        },
      },
      rules: { 'no-undef': 'error' },
    },
  ],
})

const results = await eslint.lintFiles(['client/**/*.js', 'lib/**/*.js', 'index.js'])
let errors = 0
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId !== 'no-undef') continue
    errors += 1
    console.log(`${result.filePath}:${message.line}:${message.column} ${message.message}`)
  }
}
if (errors) {
  console.log(`✖ check-undef：${errors} 处未声明变量`)
  process.exit(1)
}
console.log(`ok check-undef：${results.length} 个文件没有未声明变量`)

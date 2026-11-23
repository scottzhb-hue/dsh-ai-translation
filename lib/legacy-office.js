/**
 * Converts the pre-2007 binary Office formats (.doc / .xls / .ppt) to their
 * OOXML counterparts by driving the locally installed Microsoft Office through
 * COM automation.
 *
 * Why a child process: the DSH host process is a Node/Electron service. Talking
 * to COM from there would need a native addon, so the conversion is delegated to
 * Windows PowerShell, which can instantiate the Office applications directly.
 * The trade-off is that this only works on a Windows host with Office installed;
 * when it is unavailable the caller receives a clear, actionable error instead of
 * the misleading "文件内容为空。" the plain-text fallback used to produce.
 *
 * The conversion is deliberately isolated in its own module: `import-file.js`
 * stays a pure, synchronous parser, and only the RPC layer pays the async cost.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatError } from './errors.js'

/** Legacy extension → the OOXML extension it is converted to. */
export const LEGACY_OFFICE_TARGETS = Object.freeze({
  doc: 'docx',
  xls: 'xlsx',
  ppt: 'pptx',
})

/** COM application (and SaveAs format constant) per legacy extension. */
const COM_KINDS = Object.freeze({
  doc: 'word',
  xls: 'excel',
  ppt: 'powerpoint',
})

const CONVERT_TIMEOUT_MS = 90000
const TAIL_CHARS = 400

/**
 * PowerShell driver. Kept ASCII-only on purpose: the script is written to disk
 * and executed by Windows PowerShell, and non-ASCII would depend on the file
 * encoding surviving the round trip.
 */
const CONVERT_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string]$InPath,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [Parameter(Mandatory = $true)][string]$Kind
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutPath) { Remove-Item -LiteralPath $OutPath -Force }
switch ($Kind) {
  'word' {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $app.DisplayAlerts = 0
    try {
      # ConfirmConversions / AddToRecentFiles are off so a mislabelled file can
      # never block the automation on an interactive dialog.
      $doc = $app.Documents.Open($InPath, $false, $true, $false)
      try { $doc.SaveAs2($OutPath, 16) } finally { $doc.Close(0) }
    } finally { $app.Quit() }
  }
  'excel' {
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false
    $app.DisplayAlerts = $false
    try {
      $book = $app.Workbooks.Open($InPath, 0, $true)
      try { $book.SaveAs($OutPath, 51) } finally { $book.Close($false) }
    } finally { $app.Quit() }
  }
  'powerpoint' {
    $app = New-Object -ComObject PowerPoint.Application
    try {
      $deck = $app.Presentations.Open($InPath, -1, 0, 0)
      try { $deck.SaveAs($OutPath, 24) } finally { $deck.Close() }
    } finally { $app.Quit() }
  }
  default { throw "unsupported kind: $Kind" }
}
if (-not (Test-Path -LiteralPath $OutPath)) { throw "conversion produced no output" }
Write-Output 'CAIT_CONVERT_OK'
`

/** `report.docx` → `docx`; no extension → `''`. */
export function extensionOfFileName(name) {
  const text = String(name ?? '').trim()
  const match = text.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : ''
}

export function isLegacyOfficeExtension(extension) {
  return Object.hasOwn(LEGACY_OFFICE_TARGETS, String(extension ?? '').toLowerCase())
}

/** Drops a legacy extension from a display name, so the document title stays clean. */
export function stripLegacyExtension(name) {
  const text = String(name ?? '').trim()
  return extensionOfFileName(text) && isLegacyOfficeExtension(extensionOfFileName(text))
    ? text.replace(/\.(doc|xls|ppt)$/i, '')
    : text
}

function tail(text) {
  const value = String(text ?? '').trim()
  return value.length > TAIL_CHARS ? value.slice(-TAIL_CHARS) : value
}

function runPowerShell(scriptPath, args) {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // killing a dead process is not an error
      }
      finish({ ok: false, reason: `conversion timed out after ${CONVERT_TIMEOUT_MS / 1000}s` })
    }, CONVERT_TIMEOUT_MS)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => finish({ ok: false, reason: error?.message ?? String(error) }))
    child.on('close', (code) => {
      if (code === 0 && stdout.includes('CAIT_CONVERT_OK')) finish({ ok: true })
      else finish({ ok: false, reason: tail(stderr) || tail(stdout) || `exit code ${code}` })
    })
  })
}

/**
 * Converts one legacy Office payload.
 *
 * @param {{ base64?: string, fileName?: string, extension: string }} input
 * @returns {Promise<{ base64: string, fileName: string, convertedFrom: string, convertedTo: string }>}
 */
export async function convertLegacyOffice({ base64, fileName, extension } = {}) {
  const from = String(extension ?? '').toLowerCase()
  if (!isLegacyOfficeExtension(from)) {
    throw new CatError('LEGACY_OFFICE_EXTENSION', `不是旧版 Office 格式：.${from || '(空)'}`, 400)
  }
  const to = LEGACY_OFFICE_TARGETS[from]
  const kind = COM_KINDS[from]
  if (!base64) throw new CatError('EMPTY_FILE', '文件内容为空。')
  const source = Buffer.from(String(base64), 'base64')
  if (source.length === 0) throw new CatError('EMPTY_FILE', '文件内容为空。')

  const baseName = stripLegacyExtension(fileName) || 'imported'
  const workDir = mkdtempSync(join(tmpdir(), 'cait-office-'))
  const inPath = join(workDir, `source.${from}`)
  const outPath = join(workDir, `converted.${to}`)
  const scriptPath = join(workDir, 'convert.ps1')

  try {
    writeFileSync(inPath, source)
    writeFileSync(scriptPath, CONVERT_SCRIPT, 'utf8')
    const result = await runPowerShell(scriptPath, [
      '-InPath',
      inPath,
      '-OutPath',
      outPath,
      '-Kind',
      kind,
    ])
    let size = 0
    try {
      size = statSync(outPath).size
    } catch {
      size = 0
    }
    if (!result.ok || size === 0) {
      const reason = result.ok ? '转换结果为空' : result.reason
      throw new CatError(
        'LEGACY_OFFICE_UNAVAILABLE',
        `无法转换旧版 Office 文件（.${from}）：${reason}。请确认本机已安装 Microsoft Office（Word / Excel / PowerPoint），或把文件另存为 .${to} 后重新导入。`,
        422,
      )
    }
    return {
      base64: readFileSync(outPath).toString('base64'),
      fileName: `${baseName}.${to}`,
      convertedFrom: from,
      convertedTo: to,
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // a leftover temp directory must never fail the import
    }
  }
}

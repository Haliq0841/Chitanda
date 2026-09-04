import vm from 'node:vm'

const BLOCKED = /(?:require\s*\(|import\s|process\b|globalThis|global\b|module\b|exports\b|constructor\b|__proto__|prototype\b|eval\s*\(|Function\s*\(|(?:node:)?(?:fs|child_process|cluster|worker_threads|net|http|https| dgram|tls|vm)\b|database|sqlite|\.write\s*\(|\.exec\s*\(|\.run\s*\(|\.prepare\s*\()/i

const clone = (value) => {
  try {
    return structuredClone(value)
  } catch {
    try {
      return JSON.parse(JSON.stringify(value, (_, nested) => typeof nested === 'bigint' ? String(nested) : nested))
    } catch {
      return null
    }
  }
}

const freeze = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freeze(child, seen)
  return Object.freeze(value)
}

export async function runRestrictedEval(source, { message = {}, args = [], text = '', conn } = {}) {
  const code = String(source || '').trim()
  if (!code) return { result: undefined, output: [] }
  if (code.length > 4000) throw new Error('Eval simulasi dibatasi maksimal 4000 karakter.')
  if (BLOCKED.test(code)) throw new Error('Kode ditolak: akses proses, modul, constructor, jaringan, file, atau database tidak tersedia.')

  const output = []
  const safeConsole = Object.freeze({
    log: (...values) => output.push(values.map(String).join(' ')),
    info: (...values) => output.push(values.map(String).join(' ')),
    warn: (...values) => output.push(values.map(String).join(' ')),
    error: (...values) => output.push(values.map(String).join(' ')),
  })
  const safeMessage = freeze(clone({
    id: message.id,
    body: message.body,
    text: message.text,
    type: message.type,
    from: message.from,
    sender: message.sender,
    isGroup: message.isGroup,
    isOwner: message.isOwner,
    session: message.session,
  }) || {})
  const sessionJid = String(message.from || message.chat || '')
  const send = async (jid, content, options = {}) => {
    if (!conn?.message?.send) throw new Error('API kirim tidak tersedia pada sandbox.')
    return conn.message.send(String(jid || sessionJid), content, options)
  }
  const safeConn = Object.freeze({
    session: String(message.session || ''),
    user: freeze(clone(conn?.user || {}) || {}),
    message: Object.freeze({ send }),
    sendMessage: send,
    reply: (content, options = {}) => send(sessionJid, content, { ...options, quote: message.raw }),
  })
  const safeDb = freeze(clone({
    users: message.db?.data?.users || {},
    groups: message.db?.data?.groups || {},
    setting: { lang: message.db?.data?.setting?.lang || 'id' },
  }) || {})
  const sandbox = {
    args: freeze(clone(args) || []),
    text: String(text || ''),
    m: safeMessage,
    db: safeDb,
    conn: safeConn,
    console: safeConsole,
    fetch,
  }
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })
  let script
  try {
    script = new vm.Script(`(async () => (${code}))()`, {
      filename: 'jadibot-eval-sandbox.js',
    })
  } catch {
    script = new vm.Script(`(async () => {\n${code}\n})()`, {
      filename: 'jadibot-eval-sandbox.js',
    })
  }
  const result = await script.runInContext(context, { timeout: 750 })
  return { result: clone(result), output: output.slice(0, 20) }
}

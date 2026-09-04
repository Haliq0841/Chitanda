console.log('Starting Zapo-based bot...')

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import QRCode from 'qrcode'
import { ConsoleLogger, createStore, fetchLatestWaWebVersion } from 'zapo-js'
import { createSqliteStore as createZapoSqliteStore } from '@zapo-js/store-sqlite'
import { createSqliteStore } from './lib/db.js'
import { Client, msg } from './lib/serialize.js'
import { normalizeJid, resolveDatabaseJid, resolveOwnerJids } from './lib/identity.js'
import color from './lib/color.js'
import setting from './config.js'
import * as func from './lib/function.js'
import CommandHandler from './handler.js'

const logger = pino({
  level: String(setting.logLevel || 'error').toLowerCase() || 'error',
  timestamp: () => `,"time":"${new Date().toJSON()}"`,
})

const cliArgs = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const next = process.argv[i + 1]
  cliArgs.set(arg.slice(2), next && !next.startsWith('--') ? next : true)
}

const sessionId = String(cliArgs.get('session') || 'default')
const requestedPhone = cliArgs.get('phone') ? String(cliArgs.get('phone')).replace(/[^0-9]/g, '') : null
const requestedAuth = String(cliArgs.get('auth') || cliArgs.get('method') || '').toLowerCase()
const hasExplicitSession = cliArgs.has('session')
const createNewSession = cliArgs.has('newsession') || cliArgs.has('new-session')
const deleteSessionTarget = cliArgs.get('delete-session') ?? cliArgs.get('remove-session') ?? cliArgs.get('reset-session') ?? null
const listSessions = cliArgs.get('list-sessions') !== undefined || cliArgs.get('sessions') !== undefined || cliArgs.get('list') === 'sessions'
const isSelfMode = cliArgs.get('self') !== undefined || cliArgs.get('mode') === 'self' || Boolean(setting.self)

const defaultData = {
  users: {},
  groups: {},
  setting: {
    number: null,
    owner: setting.owner,
    noPrefix: setting.noPrefix,
    self: Boolean(setting.self),
    selfOwner: setting.selfOwner || setting.owner?.[0] || null,
    sessions: {},
  },
  contacts: {},
  groupMetadata: {},
}

const db = createSqliteStore(path.join(process.cwd(), 'db.sqlite'), defaultData)
const handler = new CommandHandler()
const legacySessionDir = path.join(process.cwd(), 'session')
const authStoreDir = path.join(process.cwd(), '.auth')
const authStoreFile = path.join(authStoreDir, 'state.sqlite')
const legacyAuthStoreFile = path.join(legacySessionDir, 'zapo.sqlite')

if (fs.existsSync(legacyAuthStoreFile) && !fs.existsSync(authStoreFile)) {
  fs.mkdirSync(authStoreDir, { recursive: true })
  fs.copyFileSync(legacyAuthStoreFile, authStoreFile)
  console.log(color.cyan('[+] Migrated legacy auth store to .auth/state.sqlite'))
}

fs.mkdirSync(authStoreDir, { recursive: true })
const persistentZapoStore = createZapoSqliteStore({ path: authStoreFile })
const store = createStore({
  backends: { sqlite: persistentZapoStore },
  providers: {
    auth: 'sqlite',
    signal: 'sqlite',
    preKey: 'sqlite',
    session: 'sqlite',
    identity: 'sqlite',
    senderKey: 'sqlite',
    appState: 'sqlite',
    privacyToken: 'sqlite',
    messages: 'sqlite',
    threads: 'sqlite',
    contacts: 'sqlite',
  },
})
let debounceTimer

const normalizeAuth = (value, fallback = 'qr') => {
  const auth = String(value || fallback).toLowerCase()
  if (['pairing', 'pair', 'code'].includes(auth)) return 'pairing'
  return 'qr'
}

const normalizeSession = (name, value = {}) => {
  const legacySelf = value.self === true || value.type === 'self'
  const session = String(value.session || name)
  const type = String(value.type || (legacySelf ? 'self' : 'public')).toLowerCase()
  const role = String(value.role || (legacySelf ? 'dev' : 'bot')).toLowerCase()
  const access = value.access && typeof value.access === 'object' ? value.access : {}
  return {
    name: String(value.name || name),
    session,
    type,
    role,
    access: {
      ownerOnly: Boolean(access.ownerOnly ?? legacySelf),
      allowedJids: Array.isArray(access.allowedJids) ? access.allowedJids : [],
      deniedJids: Array.isArray(access.deniedJids) ? access.deniedJids : [],
      commands: Array.isArray(access.commands) ? access.commands : [],
    },
    auth: normalizeAuth(value.auth, setting.usePairingCode ? 'pairing' : 'qr'),
    autoStart: value.autoStart !== false,
    number: value.number ? String(value.number).replace(/[^0-9]/g, '') : '',
    self: legacySelf,
    selfOwner: value.selfOwner || '',
    mobile: value.mobile && typeof value.mobile === 'object' ? value.mobile : {},
  }
}

const ask = async (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close()
    resolve(String(answer).trim())
  }))
}

const askAuthMethod = async (fallback = '') => {
  const value = requestedAuth || fallback
  if (value) return normalizeAuth(value)
  const answer = await ask('[+] Auth method (pairing/qr): ')
  return normalizeAuth(answer || 'qr')
}

const saveSession = async (name, value) => {
  db.data.setting.sessions[name] = normalizeSession(name, value)
  await db.write()
  return db.data.setting.sessions[name]
}

const migrateDatabaseIdentities = async (client) => {
  for (const tableName of ['users', 'contacts']) {
    const table = db.data[tableName] || {}
    for (const [jid, value] of Object.entries(table)) {
      const resolved = await resolveDatabaseJid(client, jid)
      if (!resolved || resolved === jid || !resolved.endsWith('@lid')) continue
      table[resolved] = table[resolved] && typeof table[resolved] === 'object'
        ? { ...value, ...table[resolved] }
        : value
      delete table[jid]
    }
  }
}

db.data.setting.sessions ??= {}
for (const [name, value] of Object.entries(db.data.setting.sessions)) {
  db.data.setting.sessions[name] = normalizeSession(name, value)
}
if (!Object.keys(db.data.setting.sessions).length && (db.data.setting.number || setting.self || requestedPhone)) {
  db.data.setting.sessions.default = normalizeSession('default', {
    number: db.data.setting.number || requestedPhone,
    type: setting.self ? 'self' : 'public',
    role: setting.self ? 'dev' : 'bot',
    self: setting.self,
    selfOwner: setting.selfOwner,
    auth: setting.usePairingCode ? 'pairing' : 'qr',
  })
}

if (createNewSession) {
  const requestedName = cliArgs.get('newsession') || cliArgs.get('new-session')
  const newName = String(requestedName === true || !requestedName ? await ask('[+] Session name: ') : requestedName).trim()
  if (!newName) throw new Error('Session name is required.')
  const auth = await askAuthMethod()
  const number = auth === 'qr' ? '' : (requestedPhone || await ask('[+] WhatsApp number: ')).replace(/[^0-9]/g, '')
  const type = cliArgs.has('self') ? 'self' : (await ask('[+] Session type (public/self): ') || 'public').toLowerCase()
  const role = (await ask('[+] Session role (dev/bot/user): ') || (type === 'self' ? 'dev' : 'bot')).toLowerCase()
  await saveSession(newName, {
    name: newName,
    session: newName,
    type,
    role,
    auth,
    number,
    self: type === 'self',
    selfOwner: type === 'self' ? normalizeJid(number) : '',
  })
  console.log(color.green(`[+] Session "${newName}" saved.`))
}

if (!Object.keys(db.data.setting.sessions).length) {
  const auth = await askAuthMethod(setting.usePairingCode ? 'pairing' : '')
  const number = auth === 'qr' ? '' : (requestedPhone || await ask('[+] WhatsApp number: ')).replace(/[^0-9]/g, '')
  await saveSession('default', {
    name: 'default',
    session: 'default',
    type: cliArgs.has('self') ? 'self' : 'public',
    role: cliArgs.has('self') ? 'dev' : 'bot',
    auth,
    number,
    self: cliArgs.has('self'),
    selfOwner: cliArgs.has('self') ? normalizeJid(number) : '',
  })
}

if (deleteSessionTarget !== null) {
  const targetSession = deleteSessionTarget === true ? sessionId : String(deleteSessionTarget)
  const targetName = targetSession === 'all' ? 'all sessions' : `session "${targetSession}"`

  db.data.setting.sessions ??= {}
  if (targetSession === 'all') {
    db.data.setting.sessions = {}
    db.data.setting.number = null
  } else {
    const sessionData = db.data.setting.sessions[targetSession]
    delete db.data.setting.sessions[targetSession]

    if (sessionData?.number && db.data.setting.number === sessionData.number) {
      db.data.setting.number = null
    }
  }

  await db.write()
  console.log(color.green(`[+] Removed ${targetName} from SQLite.`))
  process.exit(0)
}

if (listSessions) {
  const sessions = db?.data?.setting?.sessions ?? {}
  const keys = Object.keys(sessions)

  if (!keys.length) {
    console.log(color.yellow('[+] No sessions found in SQLite.'))
    process.exit(0)
  }

  console.log(color.cyan('[+] Registered sessions:'))
  for (const key of keys) {
    const sessionNumber = sessions[key]?.number ?? 'not set'
    console.log(`  - ${key}: ${sessionNumber}`)
  }
  process.exit(0)
}

const pluginDirectory = path.join(process.cwd(), 'plugins')

const loadPlugins = async (dir) => {
  handler.clear()
  const walk = async (currentDir) => {
    for (const item of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const resolvedPath = path.join(currentDir, item.name)
      if (item.isDirectory()) {
        await walk(resolvedPath)
      } else if (['.js', '.cjs', '.mjs'].includes(path.extname(item.name))) {
        await handler.loadPlugin(resolvedPath)
      }
    }
  }
  await walk(dir)
}

const watchDirectory = (dirPath) => {
  fs.watch(dirPath, (eventType, filename) => {
    if (!filename) return
    const filePath = path.join(dirPath, filename)
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(async () => {
      try {
        const stats = await fs.promises.stat(filePath)
        const isSupported = ['.js', '.cjs', '.mjs'].includes(path.extname(filename))
        if (stats.isFile() && isSupported) {
          console.log(color.cyan(`[INFO] Plugin updated: ${filename}`))
          await handler.loadPlugin(filePath)
        } else if (stats.isDirectory()) {
          console.log(color.green(`[INFO] Directory added: ${filename}`))
          await loadPlugins(pluginDirectory)
          watchDirectory(filePath)
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.log(color.red(`[INFO] Plugin removed: ${filename}`))
          await loadPlugins(pluginDirectory)
        } else {
          console.error('[ERROR] Could not access file:', filePath, error)
        }
      }
    }, 100)
  })

  for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (item.isDirectory()) {
      watchDirectory(path.join(dirPath, item.name))
    }
  }
}

async function getPhoneNumber() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  return new Promise((resolve) => {
    rl.question('[+] WhatsApp: ', async (value) => {
      const cleaned = String(value).replace(/[^0-9]/g, '')
      db.data.setting.sessions ??= {}
      db.data.setting.sessions[sessionId] = {
        ...(db.data.setting.sessions[sessionId] || {}),
        number: cleaned,
      }
      db.data.setting.number = cleaned
      db.data.setting.owner = setting.owner
      await db.write()
      rl.close()
      resolve(cleaned)
    })
  })
}

const resetSessionStorage = () => {
  const targets = [
    authStoreDir,
    authStoreFile,
    `${authStoreFile}-shm`,
    `${authStoreFile}-wal`,
    legacyAuthStoreFile,
    `${legacyAuthStoreFile}-shm`,
    `${legacyAuthStoreFile}-wal`,
  ]

  for (const target of targets) {
    try {
      if (!target) continue
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true })
      }
    } catch (error) {
      console.warn('[WARN] Could not remove stale session target:', target, error)
    }
  }

  fs.mkdirSync(authStoreDir, { recursive: true })
  fs.mkdirSync(legacySessionDir, { recursive: true })
}

const isCorruptedSignalSessionError = (error) => {
  const text = String(error?.message ?? error ?? '')
  return /invalid wire type|decodeSignalSessionRecord|Signal session|session record/i.test(text)
}

const isDefinitivelyInvalidSession = (reason, errorCode) => {
  const reasonText = String(reason ?? '').toLowerCase()
  return (
    errorCode === 401 ||
    errorCode === 405 ||
    reasonText.includes('invalid') ||
    reasonText.includes('not-authorized') ||
    reasonText.includes('not authorized') ||
    reasonText.includes('session') ||
    reasonText.includes('logout') ||
    reasonText.includes('logged out')
  )
}

async function connectWA(activeSessionId, sessionConfig, onPairingCode = null) {
  process.on('uncaughtException', (error) => {
    if (isCorruptedSignalSessionError(error)) {
      console.error('[ERROR] Corrupted Signal session detected. Clearing stored auth/session cache and forcing re-pair...')
      resetSessionStorage()
      process.exit(1)
      return
    }

    console.error('[ERROR] Uncaught Exception:', error && error.stack ? error.stack : error?.message || String(error))
  })

  console.log(color.yellow('[+] STARTING WHATSAPP BOT...'))

  const latest = await fetchLatestWaWebVersion()
  const version = typeof latest?.version === 'string' ? latest.version : String(latest?.version ?? '')
  const versionParts = Array.isArray(latest?.parts) ? latest.parts.join('.') : version
  console.log(color.cyan(`[+] Using WA v${versionParts}`))

  if (sessionConfig.auth === 'pairing' && !sessionConfig.number) {
    sessionConfig.number = (await ask('[+] WhatsApp number: ')).replace(/[^0-9]/g, '')
    await saveSession(activeSessionId, sessionConfig)
  }

  console.log(color.cyan(`[+] Starting session "${sessionConfig.name}" (${sessionConfig.auth})`))

  const sock = Client(db, {
    store,
    sessionId: activeSessionId,
    logger: new ConsoleLogger(String(setting.logLevel || 'error').toLowerCase() || 'error'),
  })

  sock.createSession = async (config = {}) => {
    const requestedId = String(config.session || config.name || '').trim()
    if (!requestedId) throw new Error('Session name is required.')
    if (db.data.setting.sessions[requestedId]) throw new Error(`Session "${requestedId}" already exists.`)
    const onPairingCode = typeof config.onPairingCode === 'function' ? config.onPairingCode : null
    const createdConfig = await saveSession(requestedId, {
      name: requestedId,
      session: requestedId,
      type: config.type || 'public',
      role: config.role || 'bot',
      auth: config.auth || 'pairing',
      autoStart: true,
      number: config.number || '',
      self: false,
      selfOwner: config.selfOwner || '',
      access: config.access || { ownerOnly: true },
    })
    return connectWA(requestedId, createdConfig, onPairingCode)
  }

  sock.on('auth_qr', async ({ qr }) => {
    if (sessionConfig.auth === 'qr') {
      const qrValue = typeof qr === 'string' || Buffer.isBuffer(qr) || qr instanceof ArrayBuffer ? qr : null
      if (!qrValue) {
        console.log(color.yellow('[+] QR auth started, but the payload was empty. Please retry pairing.'))
        return
      }
      console.log(await QRCode.toString(qrValue, { type: 'terminal' }))
    }
  })

  sock.on('auth_paired', ({ credentials }) => {
    sock.user = { id: credentials?.meJid ?? null, name: credentials?.meName ?? '' }
    const pairedNumber = String(credentials?.meJid || '').split('@')[0].replace(/[^0-9]/g, '')
    if (pairedNumber) {
      sessionConfig.number = pairedNumber
      saveSession(activeSessionId, sessionConfig).catch((error) => {
        console.error(`[ERROR] Could not save session "${activeSessionId}" metadata:`, error)
      })
    }
    console.log(color.green('[+] Auth paired successfully'))
  })

  sock.on('connection', async ({ status, reason }) => {
    console.log(color.yellow(`[+] Connection Status: ${status}`))

    if (status === 'close') {
      const errorCode = new Boom(reason ?? {})?.output?.statusCode

      if (isDefinitivelyInvalidSession(reason, errorCode)) {
        console.log(color.cyan('[+] Invalid session detected; removing stored auth and forcing re-pairing...'))
        resetSessionStorage()
        process.send?.('reset')
        return
      }

      switch (errorCode) {
        case 408:
        case 503:
        case 428:
        case 515:
          console.log(color.red('[+] Connection issue detected, retrying without resetting the session...'))
          try {
            await connectWA(activeSessionId, sessionConfig, onPairingCode)
          } catch (error) {
            console.error('[ERROR] Reconnect failed:', error)
          }
          break
        case 403:
          console.log(color.red('[+] WhatsApp account may be banned or blocked. Session was kept.'))
          break
        default:
          console.log(color.yellow('[+] Connection closed. Session kept because the issue is not definitively invalid.'))
      }
    }

    if (status === 'open' && !fs.existsSync('./temp')) {
      fs.mkdirSync('./temp', { recursive: true })
      console.log(color.cyan('[+] Folder "temp" successfully created.'))
    }
  })

  sock.on('message', async (event) => {
    const message = await msg(sock, event, db)
    if (!message) return
    message.sessionConfig = sessionConfig
    message.session = activeSessionId
    const sessionOwners = [
      sessionConfig.selfOwner,
      ...(sessionConfig.access?.allowedJids || []),
    ].map(normalizeJid).filter(Boolean)
    message.isOwner = sessionOwners.includes(normalizeJid(message.sender))
    const developerOwners = await resolveOwnerJids(sock, Array.isArray(db.data.setting.owner) ? db.data.setting.owner : [])
    message.isDev = developerOwners.includes(normalizeJid(message.sender))
    await handler.execute(message, sock, db, func, color, console, { type: 'notify', messages: [event] })
    await db.write()
  })

  if (sessionConfig.auth === 'pairing') {
    setTimeout(async () => {
      try {
        const code = await sock.auth?.requestPairingCode?.(sessionConfig.number)
        const formattedCode = String(code || '').match(/.{1,4}/g)?.join('-') || ''
        console.log('Your Pairing Code:', color.green(formattedCode))
        if (onPairingCode && formattedCode) await onPairingCode(formattedCode)
      } catch (error) {
        console.error('[ERROR] Pairing code request failed:', error)
      }
    }, 5000)
  }

  await sock.connect()
  sock.user ??= { id: sock.auth?.getCurrentCredentials?.()?.meJid ?? null, name: '' }
  await migrateDatabaseIdentities(sock)
  const resolvedOwners = await resolveOwnerJids(sock, [
    sessionConfig.selfOwner,
    ...(Array.isArray(db.data.setting.owner) ? db.data.setting.owner : []),
  ])
  if (resolvedOwners.length) {
    sessionConfig.selfOwner = resolvedOwners[0]
    db.data.setting.owner = resolvedOwners
    await saveSession(activeSessionId, sessionConfig)
  }
  return sock
}

await loadPlugins(pluginDirectory)
watchDirectory(pluginDirectory)

const selectedSessionIds = hasExplicitSession || cliArgs.has('self')
  ? [sessionId]
  : Object.entries(db.data.setting.sessions)
    .filter(([, config]) => config.autoStart !== false)
    .map(([id]) => id)

if (!db.data.setting.sessions[sessionId] && (hasExplicitSession || cliArgs.has('self'))) {
  const auth = await askAuthMethod()
  await saveSession(sessionId, {
    name: sessionId,
    session: sessionId,
    type: cliArgs.has('self') ? 'self' : 'public',
    role: cliArgs.has('self') ? 'dev' : 'bot',
    auth,
    number: auth === 'qr' ? '' : requestedPhone || '',
    self: cliArgs.has('self'),
    selfOwner: cliArgs.has('self') ? normalizeJid(requestedPhone) : '',
  })
}

await Promise.all(selectedSessionIds.map((activeSessionId) => {
  const sessionConfig = db.data.setting.sessions[activeSessionId] || normalizeSession(activeSessionId)
  if (cliArgs.has('self') && activeSessionId === sessionId) {
    sessionConfig.type = 'self'
    sessionConfig.role = 'dev'
    sessionConfig.self = true
    sessionConfig.access.ownerOnly = true
  }
  return connectWA(activeSessionId, sessionConfig).catch((error) => {
    console.error(`[ERROR] Session "${activeSessionId}" failed:`, error)
  })
}))
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSqliteStore } from './lib/db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const mainEntry = path.join(__dirname, 'main.js')
const db = createSqliteStore(path.join(__dirname, 'db.sqlite'))

const normalizeSessionList = () => {
  const sessions = db?.data?.setting?.sessions ?? {}
  const keys = Object.entries(sessions)
    .filter(([, session]) => session?.autoStart !== false)
    .map(([sessionId]) => sessionId)

  const list = [...new Set(keys.length ? keys : ['default'])]
  return list.filter(Boolean)
}

const childProcesses = []

const stopAll = (code = 0) => {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }
  process.exit(code)
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

const bootSession = (sessionId) => {
  const child = spawn(process.execPath, [mainEntry, '--session', sessionId], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[INFO] Session "${sessionId}" stopped by signal ${signal}`)
      return
    }

    if (code === 0) {
      console.log(`[INFO] Session "${sessionId}" exited cleanly.`)
      return
    }

    console.log(`[WARN] Session "${sessionId}" exited with code ${code}. Restarting...`)
    setTimeout(() => bootSession(sessionId), 1000)
  })

  childProcesses.push(child)
}

const sessions = normalizeSessionList()
console.log('[INFO] Starting all sessions...')
console.log(`[INFO] Found ${sessions.length} session(s): ${sessions.join(', ')}`)

for (const sessionId of sessions) {
  bootSession(sessionId)
}

setInterval(() => {}, 1000)

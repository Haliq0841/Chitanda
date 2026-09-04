import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'db.json')
const DEFAULT_SQLITE_PATH = path.resolve(process.cwd(), 'db.sqlite')
const DEFAULT_SESSION_ROOT = path.resolve(process.cwd(), 'session')

const defaultState = {
  users: {},
  groups: {},
  setting: {
    owner: [],
    noPrefix: false,
    lang: 'id',
    number: null,
  },
  contacts: {},
  groupMetadata: {},
  stats: {},
}

function parseArgs() {
  const args = new Map()
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i]
    if (!arg.startsWith('--')) continue
    const next = process.argv[i + 1]
    args.set(arg.slice(2), next && !next.startsWith('--') ? next : true)
  }
  return {
    db: args.get('db') || DEFAULT_DB_PATH,
    sqlite: args.get('sqlite') || DEFAULT_SQLITE_PATH,
    session: args.get('session') || DEFAULT_SESSION_ROOT,
    force: args.has('force'),
    dryRun: args.has('dry-run') || args.has('dryrun'),
  }
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function ensureObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  return fallback
}

function normalizeLegacyDb(raw = {}) {
  const source = ensureObject(raw)
  const setting = ensureObject(source.setting, source.settings)

  const normalized = {
    users: ensureObject(source.users),
    groups: ensureObject(source.groups),
    contacts: ensureObject(source.contacts),
    groupMetadata: ensureObject(source.groupMetadata || source.metadata),
    stats: ensureObject(source.stats),
    setting: {
      ...defaultState.setting,
      ...setting,
    },
  }

  if (!normalized.setting.owner) normalized.setting.owner = []
  if (!normalized.setting.noPrefix && typeof source.noPrefix === 'boolean') normalized.setting.noPrefix = source.noPrefix
  if (!normalized.setting.lang && source.lang) normalized.setting.lang = source.lang
  if (!normalized.setting.number && source.number) normalized.setting.number = source.number

  return {
    ...defaultState,
    ...normalized,
    setting: {
      ...defaultState.setting,
      ...normalized.setting,
    },
  }
}

async function migrateSqlite(targetSqlite, legacyData, overwrite = false) {
  const sqlitePath = path.resolve(targetSqlite)
  const sqliteDir = path.dirname(sqlitePath)
  await fs.mkdir(sqliteDir, { recursive: true })

  if (!overwrite) {
    try {
      await fs.access(sqlitePath)
      console.log(`[INFO] SQLite already exists at ${sqlitePath}. Use --force to overwrite.`)
      return false
    } catch {
      // continue
    }
  }

  const db = new DatabaseSync(sqlitePath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stats (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  const writeTable = (table, values = {}) => {
    const stmt = db.prepare(`
      INSERT INTO ${table} (id, value)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `)

    for (const [key, value] of Object.entries(values || {})) {
      stmt.run(key, JSON.stringify(value))
    }
  }

  writeTable('users', legacyData.users || {})
  writeTable('groups', legacyData.groups || {})
  writeTable('contacts', legacyData.contacts || {})
  writeTable('metadata', legacyData.groupMetadata || {})
  writeTable('stats', legacyData.stats || {})

  db.prepare(`
    INSERT INTO settings (id, value)
    VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value
  `).run('app', JSON.stringify(legacyData.setting || {}))

  db.close()
  return true
}

async function findLegacySessionFiles(root) {
  const roots = [path.resolve(root)]
  const seen = new Set()
  const files = []

  while (roots.length) {
    const current = roots.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)

    try {
      const entries = await fs.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) {
          roots.push(full)
        } else if (entry.isFile()) {
          const name = entry.name.toLowerCase()
          if (
            name === 'creds.json' ||
            name === 'auth_info_baileys.json' ||
            name === 'auth_info.json' ||
            name === 'state.json' ||
            name === 'store.json'
          ) {
            files.push(full)
          }
        }
      }
    } catch {
      // ignore missing directories
    }
  }

  return files
}

async function migrateSession(sessionRoot, legacySessionFiles) {
  const sessionDir = path.resolve(sessionRoot)
  await fs.mkdir(sessionDir, { recursive: true })

  let migrated = 0
  let targetFile = null

  for (const file of legacySessionFiles) {
    const fileName = path.basename(file).toLowerCase()
    const source = await readJson(file)
    if (!source || typeof source !== 'object') continue

    const targetDir = path.join(sessionDir, 'default')
    await fs.mkdir(targetDir, { recursive: true })

    if (fileName === 'creds.json' || fileName === 'auth_info_baileys.json' || fileName === 'auth_info.json') {
      targetFile = path.join(targetDir, 'creds.json')
      await fs.writeFile(targetFile, JSON.stringify(source, null, 2))
      migrated += 1
    }

    if (fileName === 'state.json' || fileName === 'store.json') {
      const stateTarget = path.join(targetDir, fileName)
      await fs.writeFile(stateTarget, JSON.stringify(source, null, 2))
      migrated += 1
    }
  }

  const fallbackCreds = path.join(sessionDir, 'creds.json')
  if (legacySessionFiles.length && !await exists(path.join(sessionDir, 'default', 'creds.json'))) {
    const first = await readJson(legacySessionFiles[0])
    if (first) {
      await fs.writeFile(fallbackCreds, JSON.stringify(first, null, 2))
      migrated += 1
    }
  }

  return { migrated, targetFile } 
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  const options = parseArgs()
  const dbPath = path.resolve(options.db)
  const sqlitePath = path.resolve(options.sqlite)
  const sessionRoot = path.resolve(options.session)

  const legacyRaw = await readJson(dbPath)
  if (!legacyRaw) {
    console.log(`[WARN] db.json not found at ${dbPath}. Nothing to migrate.`)
    return
  }

  const legacyData = normalizeLegacyDb(legacyRaw)

  if (options.dryRun) {
    console.log('[INFO] Dry run: no files will be overwritten.')
    console.log(`[INFO] Would migrate db.json -> ${sqlitePath}`)
    const legacySessionFiles = await findLegacySessionFiles(path.dirname(dbPath))
    const sessionFiles = legacySessionFiles.length ? legacySessionFiles : await findLegacySessionFiles(sessionRoot)
    if (sessionFiles.length) {
      console.log(`[INFO] Found ${sessionFiles.length} legacy session file(s) to copy into ${sessionRoot}`)
    } else {
      console.log(`[INFO] No old Baileys session files found in ${path.dirname(dbPath)} or ${sessionRoot}`)
    }
    return
  }

  const sqliteCreated = await migrateSqlite(sqlitePath, legacyData, options.force)

  if (sqliteCreated) {
    console.log(`[OK] Converted db.json -> ${sqlitePath}`)
  }

  const legacySessionFiles = await findLegacySessionFiles(path.dirname(dbPath))
  const sessionFiles = legacySessionFiles.length ? legacySessionFiles : await findLegacySessionFiles(sessionRoot)

  const sessionMigration = await migrateSession(sessionRoot, sessionFiles)
  if (sessionMigration.migrated > 0) {
    console.log(`[OK] Migrated session files into ${sessionRoot}`)
  } else {
    console.log(`[INFO] No old Baileys session files found in ${path.dirname(dbPath)} or ${sessionRoot}`)
  }
}

main().catch((error) => {
  console.error('[ERROR] Migration failed:', error)
  process.exit(1)
})

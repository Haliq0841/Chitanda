import { DatabaseSync } from 'node:sqlite'

const defaultState = {
  users: {},
  groups: {},
  setting: {
    owner: [],
    noPrefix: false,
    lang: 'id',
  },
  contacts: {},
  groupMetadata: {},
  stats: {},
}

const parseJSON = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export class SqliteStore {
  constructor(filePath = 'db.sqlite', initialState = {}) {
    this.path = filePath
    this.db = new DatabaseSync(filePath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stats (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)

    this.defaultState = {
      ...defaultState,
      ...initialState,
      setting: {
        ...defaultState.setting,
        ...initialState.setting,
      },
    }

    this.data = this.loadState()
  }

  loadState() {
    const state = {
      users: this.readTable('users'),
      groups: this.readTable('groups'),
      contacts: this.readTable('contacts'),
      groupMetadata: this.readTable('metadata'),
      stats: this.readTable('stats'),
      setting: {
        ...this.defaultState.setting,
        ...this.readSetting(),
      },
    }

    return {
      ...this.defaultState,
      ...state,
      setting: {
        ...this.defaultState.setting,
        ...state.setting,
      },
    }
  }

  readTable(name) {
    const rows = this.db.prepare(`SELECT id, value FROM ${name}`).all() || []
    const result = {}

    for (const row of rows) {
      result[row.id] = parseJSON(row.value, row.value)
    }

    return result
  }

  readSetting() {
    const row = this.db.prepare('SELECT value FROM settings WHERE id = ?').get('app')
    return row ? parseJSON(row.value, {}) : {}
  }

  writeTable(name, values = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO ${name} (id, value)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `)

    for (const [key, value] of Object.entries(values || {})) {
      stmt.run(key, JSON.stringify(value))
    }
  }

  async write() {
    this.writeTable('users', this.data.users || {})
    this.writeTable('groups', this.data.groups || {})
    this.writeTable('contacts', this.data.contacts || {})
    this.writeTable('metadata', this.data.groupMetadata || {})
    this.writeTable('stats', this.data.stats || {})
    this.db.prepare(`
      INSERT INTO settings (id, value)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `).run('app', JSON.stringify(this.data.setting || {}))
    return this
  }

  async sync() {
    return this.write()
  }

  ensureUser(id, defaults = {}) {
    if (!id) return null
    this.data.users ??= {}
    if (!this.data.users[id]) this.data.users[id] = {}
    Object.assign(this.data.users[id], defaults)
    return this.data.users[id]
  }

  ensureGroup(id, defaults = {}) {
    if (!id) return null
    this.data.groups ??= {}
    if (!this.data.groups[id]) this.data.groups[id] = {}
    Object.assign(this.data.groups[id], defaults)
    return this.data.groups[id]
  }

  getUser(id) {
    return id ? this.data.users?.[id] ?? null : null
  }

  getGroup(id) {
    return id ? this.data.groups?.[id] ?? null : null
  }

  getContact(id) {
    return id ? this.data.contacts?.[id] ?? null : null
  }

  setSetting(value = {}) {
    this.data.setting = {
      ...(this.data.setting || {}),
      ...value,
    }
    return this.data.setting
  }
}

export function createSqliteStore(filePath = 'db.sqlite', initialState = {}) {
  return new SqliteStore(filePath, initialState)
}

export default createSqliteStore

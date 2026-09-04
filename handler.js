import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const isNumber = (value) => typeof value === 'number' && !Number.isNaN(value)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function sendOwnerOnlyAlert(sock, db, error, fallbackSender = null, sessionConfig = null) {
  const setting = db?.data?.setting || {}
  if (!sessionConfig?.access?.ownerOnly && !sessionConfig?.self) return false

  const normalizeJid = (value) => {
    if (!value) return ''
    const trimmed = String(value).trim()
    if (!trimmed) return ''
    if (trimmed.includes('@')) return trimmed
    const clean = trimmed.replace(/[^0-9]/g, '')
    return clean ? `${clean}@s.whatsapp.net` : ''
  }

  const ownerList = Array.isArray(setting.owner) ? setting.owner : [setting.owner].filter(Boolean)
  const target = normalizeJid(sessionConfig.selfOwner || ownerList[0] || fallbackSender || '')
  if (!target || !sock?.message?.send) return false

  let detail = ''
  if (error instanceof Error) {
    detail = error.stack || error.message || String(error)
  } else {
    detail = String(error ?? 'Unknown error')
  }

  if (detail.length > 2000) {
    detail = `${detail.slice(0, 1990)}...`
  }

  try {
    await sock.message.send(target, `⚠️ Bot error only for owner\n\n${detail}`)
    return true
  } catch (sendError) {
    console.error('[ERROR] Failed to send owner-only alert:', sendError)
    return false
  }
}

export default class CommandHandler {
  constructor() {
    this.commands = new Map()
    this.plugins = new Map()
    this.functions = []
    this.prefixes = ['.', ',', '/', '\\', '#', '!']
    this.executedCommands = new Set()
  }

  addFunction(fn) {
    if (typeof fn === 'function') {
      this.functions.push(fn)
    }
  }

  clear() {
    this.plugins.clear()
  }

  async loadPlugin(filePath) {
    try {
      const resolvedPath = path.resolve(filePath)
      if (require.cache[resolvedPath]) {
        delete require.cache[resolvedPath]
      }

      const namePlugin = path.basename(filePath)
      const ext = path.extname(filePath)
      let module

      if (ext === '.cjs') {
        module = require(resolvedPath)
      } else if (ext === '.js' || ext === '.mjs') {
        const fileUrl = `${pathToFileURL(resolvedPath).href}?${Date.now()}`
        module = await import(fileUrl).catch((error) => {
          console.error('[ERROR] Failed to import module:', error)
          return null
        })
      } else {
        return false
      }

      if (!module) return false

      const plugin = module.default ?? module
      if (typeof plugin === 'function') {
        this.plugins.set(namePlugin, plugin)
        return true
      }

      return false
    } catch (error) {
      console.error('[ERROR] Failed to load plugin:', filePath, error)
      return false
    }
  }

  async dfail(type, m, _conn) {
    const message = {
      owner: '*Only Owner can use this command!*',
      group: '*This command can only be used in groups!*',
      private: '*This command can only be used in private chat!*',
      admin: '*Only Admins can use this command!*',
      botAdmin: '*Bot must be an Admin to execute this command!*',
      nsfw: '*NSFW feature is not activated in this group!*',
      restrict: '*This command is restricted by the owner!*',
      premium: '*Only Premium users can use this command!*',
      unreg: '*You are not registered yet!*\n\nType .register to register.',
    }[type]

    if (message) {
      return m.reply(message)
    }
  }

  async execute(m, sock, db, func, color, util, messages) {
    try {
      const resolveBodyText = (source) => {
        if (!source || typeof source !== 'object') return ''
        const direct = [
          source.text,
          source.caption,
          source.conversation,
          source.contentText,
          source.selectedButtonId,
          source.selectedRowId,
          source.selectedId,
          source.selectedDisplayText,
          source.body,
          source.title,
          source.name,
        ]
        for (const value of direct) {
          if (typeof value === 'string' && value.trim()) return value.trim()
        }
        for (const key of ['message', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'quotedMessage', 'contextInfo']) {
          if (!source[key]) continue
          const nested = resolveBodyText(source[key])
          if (nested) return nested
        }
        return ''
      }

      let bodyText = typeof m?.body === 'string' ? m.body.trim() : ''
      if (!bodyText) bodyText = resolveBodyText(m?.message)
      if (!bodyText) bodyText = resolveBodyText(m?.msg)
      if (!bodyText && typeof m?.quoted?.body === 'string') {
        bodyText = m.quoted.body.trim()
      }
      if (!bodyText && typeof m?.message?.extendedTextMessage?.text === 'string') {
        bodyText = m.message.extendedTextMessage.text.trim()
      }
      if (!bodyText && typeof m?.message?.conversation === 'string') {
        bodyText = m.message.conversation.trim()
      }

      if (!m || !bodyText || this.executedCommands.has(m.id)) return false
      m.body = bodyText
      this.executedCommands.add(m.id)

      for (const fn of this.functions) {
        try {
          await fn(m, { sock, db, color, func })
        } catch (error) {
          console.error('[ERROR] Error in global function handler:', error)
        }
      }

      const text = m.body.trim()
      const sessionConfig = m.sessionConfig || {}
      const gc = m.isGroup ? db?.data?.groups?.[m.from] : false
      const usr = db?.data?.users?.[m.sender] || {}
      const isPrems = m.isOwner || usr.premium || false

      if (db?.data?.setting?.autoread) {
        await sock.readMessages?.([m.key])
      }

      for (const [pluginName, plugin] of this.plugins.entries()) {
        if (!plugin || plugin.disabled) continue

        const fail = plugin.fail || this.dfail
        m.limit = false
        m.exp = 0

        if (typeof plugin.all === 'function') {
          try {
            await plugin.all.call(sock, m, { conn: sock, chatUpdate: messages, db, func, color, util })
          } catch (error) {
            console.error(`[ERROR] Error in plugin 'all' method (${pluginName}):`, error)
          }
        }

        if (typeof plugin.before === 'function') {
          const shouldSkip = await plugin.before.call(sock, m, {
            conn: sock,
            db,
            func,
            color,
            util,
            chatUpdate: messages,
            __dirname,
          })
          if (shouldSkip) continue
        }

        const customPrefix = plugin.customPrefix || this.prefixes
        const usedPrefix = customPrefix.find((prefix) => text.startsWith(prefix))
        if (!usedPrefix && !plugin.noPrefix && !db?.data?.setting?.noPrefix) continue

        const noPrefix = usedPrefix ? text.replace(usedPrefix, '') : text
        let [command, ...args] = noPrefix.trim().split(/\s+/).filter(Boolean)
        args = args || []
        const textMessage = noPrefix.trim().split(/\s+/).slice(1).join(' ')
        const normalizedCommand = (command || '').toLowerCase()

        const isAccept = plugin.command instanceof RegExp
          ? plugin.command.test(normalizedCommand)
          : Array.isArray(plugin.command)
            ? plugin.command.some((cmd) => cmd instanceof RegExp ? cmd.test(normalizedCommand) : cmd === normalizedCommand)
            : typeof plugin.command === 'string'
              ? plugin.command === normalizedCommand
              : false

        if (!isAccept) continue

        const access = sessionConfig.access || {}
        const allowedJids = access.allowedJids || []
        const deniedJids = access.deniedJids || []
        const senderAllowed = allowedJids.length === 0 || allowedJids.includes(m.sender)
        const senderDenied = deniedJids.includes(m.sender)
        const commandAllowed = !access.commands?.length || access.commands.includes(normalizedCommand)
        if ((sessionConfig.access?.ownerOnly || sessionConfig.self) && !m.isOwner || !senderAllowed || senderDenied || !commandAllowed) {
          await sendOwnerOnlyAlert(sock, db, `Unauthorized access attempt: ${m.sender || 'unknown'} -> ${normalizedCommand || 'command'}\nBody: ${text.slice(0, 300)}`, null, sessionConfig)
          continue
        }
        if (plugin.dev && !m.isDev) {
          fail('owner', m, sock)
          continue
        }
        if (plugin.owner && !m.isOwner && !m.isDev) {
          fail('owner', m, sock)
          continue
        }
        if (plugin.group && !m.isGroup) {
          fail('group', m, sock)
          continue
        }
        if (plugin.private && m.isGroup) {
          fail('private', m, sock)
          continue
        }
        if (plugin.admin && m.isGroup && !m.isAdmin) {
          fail('admin', m, sock)
          continue
        }
        if (plugin.botAdmin && m.isGroup && !m.isBotAdmin) {
          fail('botAdmin', m, sock)
          continue
        }
        if (plugin.nsfw && m.isGroup && !gc?.nsfw) {
          fail('nsfw', m, sock)
          continue
        }
        if (plugin.restrict && db?.data?.setting?.restrict && !m.isOwner) {
          fail('restrict', m, sock)
          continue
        }
        if (plugin.premium && !isPrems) {
          fail('premium', m, sock)
          continue
        }
        if (plugin.registered && !usr.registered) {
          fail('unreg', m, sock)
          continue
        }

        m.isCommand = true
        const xp = Number.isFinite(Number(plugin.exp)) ? Number(plugin.exp) : 17
        m.exp += xp

        db.data.users ??= {}
        db.data.users[m.sender] ??= {}

        if (!isPrems && plugin.limit && (usr.limit ?? 0) < plugin.limit) {
          m.reply(`Your limit is not enough to use this command, need ${plugin.limit} limit`)
          continue
        }

        const extra = {
          conn: sock,
          args,
          db,
          func,
          color,
          util,
          thisClass: this,
          chatUpdate: messages,
          command: normalizedCommand,
          text: textMessage,
          usedPrefix,
          noPrefix,
          groupMetadata: db?.data?.groupMetadata?.[m.from],
          isPrems,
          isOwner: m.isOwner,
          isDev: m.isDev,
          session: m.session,
          sessionConfig,
          isAdmin: m.isAdmin,
          isBotAdmin: m.isBotAdmin,
          __dirname,
        }

        if (!isPrems) {
          m.limit = m.limit || plugin.limit || false
        }

        try {
          m.plugin = pluginName
          await plugin.call(sock, m, extra)
        } catch (error) {
          m.error = error
          console.error(`[ERROR] Error in plugin command method (${pluginName}):`, error)
          if (sessionConfig.access?.ownerOnly || sessionConfig.self) {
            await sendOwnerOnlyAlert(sock, db, error, m?.sender || null, sessionConfig)
          } else {
            try {
              const rawMessage = error instanceof Error ? error.message : (error ?? 'Unknown error')
              const messageText = rawMessage == null ? 'Unknown error' : String(rawMessage)
              await m.reply(messageText)
            } catch (replyError) {
              console.error('[ERROR] Failed to notify plugin error back to user:', replyError)
            }
          }
        } finally {
          if (typeof plugin.after === 'function') {
            try {
              await plugin.after.call(sock, m, extra)
            } catch (error) {
              console.error(`[ERROR] Error in plugin 'after' method (${pluginName}):`, error)
            }
          }
        }

        if (m.limit) {
          db.data.users[m.sender].limit = (db.data.users[m.sender].limit || 0) - Number(m.limit)
          m.reply(`${Number(m.limit)} ʟɪᴍɪᴛ ᴋᴀᴍᴜ ᴛᴇʀᴘᴀᴋᴀɪ ✔️`)
        }

        if (m.exp) {
          db.data.users[m.sender].exp = (db.data.users[m.sender].exp || 0) + Number(m.exp)
        }
      }
    } catch (error) {
      console.error('[ERROR] Error in execute method:', error)
      if (db?.data?.setting?.self) {
        await sendOwnerOnlyAlert(sock, db, error, m?.sender || null)
      }
    } finally {
      db.data.stats ??= {}
      const stats = db.data.stats
      if (m?.plugin) {
        const now = Date.now()
        const stat = stats[m.plugin] ?? {}
        stat.total = isNumber(stat.total) ? stat.total + 1 : 1
        stat.success = isNumber(stat.success) ? stat.success + (m.error == null ? 1 : 0) : (m.error == null ? 1 : 0)
        stat.last = now
        stat.lastSuccess = m.error == null ? now : (isNumber(stat.lastSuccess) ? stat.lastSuccess : 0)
        stats[m.plugin] = stat
      }
      await db.write?.()
    }
  }
}
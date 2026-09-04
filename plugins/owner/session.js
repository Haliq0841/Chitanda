import { normalizeJid, resolveDatabaseJid } from '../../lib/identity.js'

const parseSessionAction = (text = '') => {
  const clean = String(text).trim().toLowerCase()
  if (!clean) return 'list'
  if (['list', 'ls', 'show'].includes(clean)) return 'list'
  if (['self', 'owner', 'normal', 'public'].includes(clean)) return clean
  return 'unknown'
}

const handler = async (m, { db, args, usedPrefix, conn, isDev }) => {
  if (!db?.data?.setting) return m.reply('Database setting not available.')

  const sessions = db.data.setting.sessions ?? {}
  const [action, targetSession, value] = args
  const mode = parseSessionAction(value || action || 'list')

  if (action === 'lid' || action === 'checklid') {
    const target = args[1]
    if (!target) return m.reply(`Contoh: ${usedPrefix}session lid 6281234567890`)
    const lid = await resolveDatabaseJid(conn, target)
    return m.reply(lid.endsWith('@lid') ? `LID: ${lid}` : `LID belum ditemukan. JID canonical: ${lid}`)
  }

  if (!action || action === 'list' || action === 'ls' || action === 'show') {
    const keys = Object.keys(sessions)
    if (!keys.length) {
      return m.reply('Tidak ada session yang tersimpan.')
    }

    const lines = keys.map((sessionId) => {
      const sessionData = sessions[sessionId] || {}
      const number = sessionData.number || 'not set'
      return `- ${sessionId}: ${number} | type=${sessionData.type || (sessionData.self ? 'self' : 'public')} | role=${sessionData.role || 'bot'} | auth=${sessionData.auth || 'qr'}`
    })

    return m.reply(`Daftar session:\n${lines.join('\n')}`)
  }

  if (action !== 'set') {
    return m.reply(`Format salah.\nContoh:\n${usedPrefix}session list\n${usedPrefix}session set default self\n${usedPrefix}session set default normal\n${usedPrefix}session set default owner 6281234567890`)
  }

  if (!targetSession) {
    return m.reply(`Silakan tentukan session.\nContoh:\n${usedPrefix}session set default self`)
  }
  if (targetSession !== m.session && !isDev) {
    return m.reply('Owner sesi hanya dapat mengatur sesi yang sedang aktif.')
  }

  sessions[targetSession] ??= {}
  const sessionData = sessions[targetSession]

  if (['type', 'role', 'auth', 'name', 'number'].includes(value)) {
    const nextValue = args[3]
    if (!nextValue) return m.reply(`Nilai ${value} diperlukan.`)
    if (value === 'type' && !['self', 'public', 'private'].includes(nextValue.toLowerCase())) return m.reply('Type: self, public, private.')
    if (value === 'role' && !['dev', 'bot', 'user', 'jadibot'].includes(nextValue.toLowerCase())) return m.reply('Role: dev, bot, user, jadibot')
    if (value === 'auth' && !['pairing', 'qr'].includes(nextValue.toLowerCase())) return m.reply('Auth: pairing, qr.')
    sessionData[value] = value === 'number' ? nextValue.replace(/[^0-9]/g, '') : nextValue.toLowerCase()
    if (value === 'type') {
      sessionData.self = sessionData.type === 'self'
      sessionData.access.ownerOnly = sessionData.self
    }
    await db.write()
    return m.reply(`Session "${targetSession}" ${value} diatur ke ${sessionData[value]}.`)
  }

  if (value === 'access') {
    const accessKey = String(args[3] || '').toLowerCase()
    const accessValue = args.slice(4).join(' ')
    if (!['owneronly', 'allowed', 'denied', 'commands'].includes(accessKey)) {
      return m.reply('Access: owneronly on|off, allowed <jid,...>, denied <jid,...>, commands <cmd,...>')
    }
    if (accessKey === 'owneronly') {
      sessionData.access.ownerOnly = ['on', 'true', '1'].includes(accessValue.toLowerCase())
    } else {
      const key = { allowed: 'allowedJids', denied: 'deniedJids', commands: 'commands' }[accessKey]
      sessionData.access[key] = accessValue.split(',').map((item) => item.trim()).filter(Boolean)
      if (key !== 'commands') sessionData.access[key] = sessionData.access[key].map(normalizeJid)
    }
    await db.write()
    return m.reply(`Access session "${targetSession}" berhasil diperbarui.`)
  }

  if (value === 'self') {
    const ownerJid = await resolveDatabaseJid(conn, sessionData.selfOwner || sessionData.number || m.sender)
    sessionData.self = true
    sessionData.selfOwner = ownerJid || m.sender
    sessionData.access ??= {}
    sessionData.access.ownerOnly = true
    sessionData.access.allowedJids = [ownerJid || m.sender]
    if (sessionData.number) {
      sessionData.number = String(sessionData.number).replace(/[^0-9]/g, '')
    }
    await db.write()
    return m.reply(`Session "${targetSession}" diatur ke mode self.\nOwner: ${ownerJid || m.sender}`)
  }

  if (value === 'normal' || value === 'public') {
    sessionData.self = false
    delete sessionData.selfOwner
    await db.write()
    return m.reply(`Session "${targetSession}" diatur ke mode normal.`)
  }

  if (value === 'owner') {
    const ownerTarget = await resolveDatabaseJid(conn, args[2] || sessionData.number || m.sender)
    if (!ownerTarget) {
      return m.reply('Nomor owner tidak valid. Contoh: 6281234567890')
    }
    sessionData.self = true
    sessionData.selfOwner = ownerTarget
    sessionData.access ??= {}
    sessionData.access.ownerOnly = true
    sessionData.access.allowedJids = [ownerTarget]
    await db.write()
    return m.reply(`Session "${targetSession}" diatur ke owner: ${ownerTarget}`)
  }

  return m.reply(`Mode tidak valid. Pilihan: self, normal, owner.\nContoh:\n${usedPrefix}session set default self\n${usedPrefix}session set default normal\n${usedPrefix}session set default owner 6281234567890`)
}

handler.help = ['session']
handler.tags = ['owner']
handler.command = /^(session)$/i
handler.owner = true
handler.dev = true

export default handler

const normalizePhone = (value) => String(value || '').replace(/[^0-9]/g, '')

const sanitizeSessionName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^[-_]+|[-_]+$/g, '')

const handler = async (m, { args, conn, command, isDev }) => {
  if (typeof conn.createSession !== 'function') {
    return m.reply('Fitur jadibot belum tersedia pada koneksi ini.')
  }

  const selfDevMode = command === 'jadibotselfdev'
  const selfMode = command === 'jadibotself' || selfDevMode
  if (selfDevMode && !isDev) {
    return m.reply('Command jadibotselfdev hanya dapat digunakan oleh developer utama.')
  }

  const phone = normalizePhone(args[0])
  if (!phone || phone.length < 8) {
    return m.reply(`Format: .${command} 6281234567890 [nama-sesi]`)
  }

  const sessionOwner = selfDevMode ? `${phone}@s.whatsapp.net` : m.sender
  const sessionName = sanitizeSessionName(args[1] || `user-${phone}`)
  if (!sessionName) return m.reply('Nama sesi tidak valid.')

  try {
    const startup = conn.createSession({
      name: sessionName,
      session: sessionName,
      type: selfMode ? 'self' : 'public',
      role: selfDevMode ? 'dev' : 'jadibot',
      auth: 'pairing',
      autoStart: true,
      number: phone,
      self: selfMode,
      selfOwner: sessionOwner,
      onPairingCode: (code) => m.reply(`Pairing code untuk sesi "${sessionName}": ${code}`),
      access: {
        ownerOnly: true,
        allowedJids: [sessionOwner],
        deniedJids: [],
        commands: [],
      },
    })
    startup.catch((error) => {
      console.error(`[ERROR] Jadibot session "${sessionName}" failed:`, error)
    })

    await m.reply(
      `Sesi jadibot${selfMode ? ' self' : ''} "${sessionName}" dibuat untuk nomor ${phone}.\n` +
      `Pairing code akan dikirim di chat ini dan muncul di terminal.\n` +
      `Owner sesi: ${sessionOwner}\n` +
      `Mode: ${selfDevMode ? 'selfdev (akses dev penuh)' : selfMode ? 'self (owner-only)' : 'public'}. ` +
      `${selfDevMode ? 'Role dev.' : 'Role jadibot; akses dev/eval/db tetap hanya untuk developer utama.'}`,
    )
  } catch (error) {
    await m.reply(`Gagal membuat sesi jadibot: ${error instanceof Error ? error.message : String(error)}`)
  }
}

handler.help = [
  'jadibot <nomor> [nama-sesi]',
  'jadibotself',
  'jadibotselfdev',
]
handler.tags = ['jadibot']
handler.command = /^(jadibot|jadibotself|jadibotselfdev)$/i

export default handler

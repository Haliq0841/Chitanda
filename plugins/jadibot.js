const normalizePhone = (value) => String(value || '').replace(/[^0-9]/g, '')

const sanitizeSessionName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^[-_]+|[-_]+$/g, '')

const handler = async (m, { args, conn }) => {
  if (typeof conn.createSession !== 'function') {
    return m.reply('Fitur jadibot belum tersedia pada koneksi ini.')
  }

  const phone = normalizePhone(args[0])
  if (!phone || phone.length < 8) {
    return m.reply('Format: .jadibot 6281234567890 [nama-sesi]')
  }

  const sessionName = sanitizeSessionName(args[1] || `user-${phone}`)
  if (!sessionName) return m.reply('Nama sesi tidak valid.')

  try {
    const startup = conn.createSession({
      name: sessionName,
      session: sessionName,
      type: 'public',
      role: 'jadibot',
      auth: 'pairing',
      autoStart: true,
      number: phone,
      selfOwner: m.sender,
      onPairingCode: (code) => m.reply(`Pairing code untuk sesi "${sessionName}": ${code}`),
      access: {
        ownerOnly: true,
        allowedJids: [m.sender],
        deniedJids: [],
        commands: [],
      },
    })
    startup.catch((error) => {
      console.error(`[ERROR] Jadibot session "${sessionName}" failed:`, error)
    })

    await m.reply(
      `Sesi jadibot "${sessionName}" dibuat untuk nomor ${phone}.\n` +
      `Pairing code akan dikirim di chat ini dan muncul di terminal.\n` +
      `Owner sesi: ${m.sender}\n` +
      'Role: jadibot. Akses dev/eval/db tetap hanya untuk developer utama.',
    )
  } catch (error) {
    await m.reply(`Gagal membuat sesi jadibot: ${error instanceof Error ? error.message : String(error)}`)
  }
}

handler.help = ['jadibot <nomor> [nama-sesi]']
handler.tags = ['jadibot']
handler.command = /^jadibot$/i

export default handler

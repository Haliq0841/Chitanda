import fs from 'fs'
import { Buffer} from 'buffer'

const handler = async (m, extra) => {
  const { text, usedPrefix, command, conn} = extra

  if (!text) throw `❗ Teksnya mana?\n\nContoh:\n${usedPrefix + command} plugins/main/tes.js\nAtau:\n${usedPrefix + command} plugins/main/tes.js|command|arg1 arg2`
  if (!m.quoted?.text) throw `❗ Balas pesan yang berisi kode!`

  const [path, cmd, argsText] = text.split('|')
  const ext = path.split('.').pop()
  const encoded = Buffer.from(m.quoted.text).toString('base64')

  if (cmd) {
    let module
    try {
      module = await import(`data:text/javascript;base64,${encoded}`)
    } catch (err) {
        throw `❌ Gagal mengimpor modul:\n${err}`
    }

    const context = {
        ...extra,
        command: cmd,
        text: argsText,
        args: argsText? argsText.split(/\s+/): [],
        _args: argsText? argsText.split(/\s+/): [],
    }

    try {
        const result = await module.default?.call(conn, m, context)
        m.reply(`✅ Berhasil dijalankan:\n\n${result?? '(tidak ada output)'}`)
    } catch (err) {
        throw `❌ Error saat menjalankan modul:\n${err}`
    }
    } else {
    try {
      fs.writeFileSync(path, m.quoted.text)
      m.reply(`✅ Tersimpan di: ${path}`)
    } catch (err) {
      throw `❌ Gagal menyimpan file:\n${err}`
    }
    }
}

handler.help = ['sf <path>|command|args']
handler.tags = ['owner']
handler.command = /^sf$/i
handler.owner = true

export default handler

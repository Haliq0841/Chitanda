import fs from 'fs'
import path from 'path'

const handler = async (m, extra) => {
  const { text, usedPrefix, command, conn} = extra

  if (!text) throw `❗ Teksnya mana?\n\nContoh:\n${usedPrefix + command} plugins/main/tes.js\nAtau:\n${usedPrefix + command} plugins/main/tes.js|command|arg1 arg2`
  if (!m.quoted?.body) throw `❗ Balas pesan yang berisi kode!`
  
  let rawCode = `${m.quoted.body}`.trim()
  if (rawCode.startsWith('```') && rawCode.endsWith('```')) {
     rawCode = rawCode.slice(3, -3).trim()
  }
  rawCode = rawCode
    .replace(/[\u200B-\u200D\u200E\u200F\uFEFF\u00A0]/g, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim()
  let code = rawCode.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '').trim()

  const [targetPath, cmd, argsText] = text.split('|')

  if (cmd) {
    const context = {
        ...extra,
        command: cmd,
        text: argsText,
        args: argsText ? argsText.split(/\s+/) : [],
        _args: argsText ? argsText.split(/\s+/) : [],
    }

    try {
        let executionFunction
        let isESM = code.includes('import ') || code.includes('export default')
        
        if (isESM) {
            const tempFileName = `temp_execute_${Date.now()}.mjs`
            const tempFilePath = path.join(process.cwd(), tempFileName)
            
            try {
                fs.writeFileSync(tempFilePath, code, { encoding: 'utf8' })
                const module = await import(`file://${tempFilePath}?update=${Date.now()}`)
                executionFunction = module.default
            } finally {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath)
            }
        } else {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
            const cleanCode = code.replace(/module\.exports\s*=\s*/g, 'return ')
            executionFunction = new AsyncFunction('conn', 'm', 'context', cleanCode)
        }

        if (typeof executionFunction !== 'function') {
            throw 'Struktur kode tidak valid. Pastikan modul menggunakan "export default".'
        }
        let result
        if (isESM) {
            result = await executionFunction.call(conn, m, context)
        } else {
            result = await executionFunction.call(conn, conn, m, context)
        }

        m.reply(`✅ Berhasil dijalankan:\n\n${result ?? '(tidak ada output)'}`)

    } catch (err) {
        throw `❌ Error saat menjalankan modul:\n${err.stack || err}`
    }
  } else {
    try {
      fs.writeFileSync(targetPath, rawCode, 'utf-8')
      m.reply(`✅ Tersimpan di: ${targetPath}`)
    } catch (err) {
      throw `❌ Gagal menyimpan file:\n${err}`
    }
  }
}

handler.help = ['sf <path>|command?|args?']
handler.tags = ['owner']
handler.command = /^sf$/i
handler.owner = true
handler.dev = true

export default handler

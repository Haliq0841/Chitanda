import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
let handler = async (m, exstra) => {
    const exxtra = exstra
    let extra = exxtra
    const { text, usedPrefix, command , conn} = extra
    if (!text) throw `uhm.. teksnya mana?\n\npenggunaan:\n${usedPrefix + command} <teks>\n\ncontoh:\n${usedPrefix + command} plugins/main/tes.js\nopsional:\n${usedPrefix + command} plugins/main/tes.js|command|teks/args`
    if (!m.quoted.text) throw `balas pesan nya!`
    let [path, ...act] = text.split('|')
    const encoded = Buffer.from(m.quoted.text).toString('base64');
    const ext = path.split('.').pop()
    const module = ext === 'cjs' ? createRequire(`data:text/javascript;base64,${encoded}`).catch(err => {throw err}) : await import(`data:text/javascript;base64,${encoded}`).catch(err => {throw err})
    if (act[0]) {
        let res = ''
        extra.command = act[0]
        extra.text = act[1]
        extra.args = act[1] ? act[1].split` `.filter(v => v) : []
        extra._args = extra.args
        const mess = m
        let message = mess
        message.quoted = undefined
        try {
            res = await module.call(conn, m, extra)
        } catch (e) {
            throw e
        }
        m.reply(`Berhasil di jalankan:\n\n${res}`)
    } else {
        await fs.writeFileSync(path, m.quoted.text)
        m.reply(`tersimpan di ${path}`)
    }
    
}
handler.help = ['sf'].map(v => v + ' <teks>')
handler.tags = ['owner']
handler.command = /^sf$/i

handler.owner = true
export default handler
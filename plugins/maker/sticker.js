import fs from "fs"

let handler = async (m, { conn, db, command, usedPrefix }) => {
let q = m.quoted ? m.quoted : m
let mime = (q.msg || q).mimetype || ''
if (/image/.test(mime)) {
  let media = await q.download()
  let encmedia = await conn.sendImageAsSticker(m.from, media, m, { packname: m.pushName, author: db.data.setting.packname })
  await fs.unlinkSync(encmedia)
  } else if (/video/.test(mime)) {
  if ((q.msg || q).seconds > 7) return m.reply('maksimal 6 detik!')
  let media = await q.download()
  let encmedia = await conn.sendVideoAsSticker(m.from, media, m, { packname: m.pushName, author: db.data.setting.packname })
  await fs.unlinkSync(encmedia)
  } else {
  throw `Kirim Gambar/Video Dengan Caption ${usedPrefix + command}\nDurasi Video 1-6 Detik`
  }
}

handler.help = ['sticker']
handler.tags = ['maker']
handler.command = /^(stiker|s|sticker)$/i
handler.limit = false

export default handler
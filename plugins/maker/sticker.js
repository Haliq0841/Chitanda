import fs from "fs"

let handler = async (m, { conn, db, text, command, usedPrefix }) => {
  let q = m.quoted ? m.quoted : m
  let mime = (q.msg || q).mimetype || ''
  
  let [packname, author] = text ? text.split('|') : [null, null]
  
  let finalPackname = packname || m.pushName
  let finalAuthor = author || db.data?.setting?.packname || ''

  if (/image/.test(mime)) {
    let media = await q.download()
    let encmedia = await conn.sendImageAsSticker(m.chat, media, m, { 
      packname: finalPackname, 
      author: finalAuthor 
    })
    if (fs.existsSync(encmedia)) fs.unlinkSync(encmedia)
    
  } else if (/video/.test(mime)) {
    if ((q.msg || q).seconds > 7) throw 'Maksimal 6 detik!'
    
    let media = await q.download()
    let encmedia = await conn.sendVideoAsSticker(m.chat, media, m, { 
      packname: finalPackname, 
      author: finalAuthor 
    })
    if (fs.existsSync(encmedia)) fs.unlinkSync(encmedia)
    
  } else {
    throw `Kirim Gambar/Video Dengan Caption ${usedPrefix + command}\nDurasi Video 1-6 Detik`
  }
}

handler.help = ['sticker']
handler.tags = ['maker']
handler.command = /^(stiker|s|sticker)$/i
handler.limit = false

export default handler

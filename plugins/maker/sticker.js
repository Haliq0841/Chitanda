import { imageToWebp, videoToWebp } from '../../lib/exif.js'

let handler = async (m, { conn, db, text, command, usedPrefix }) => {
  let q = m.quoted ? m.quoted : m
  let mime = (q.msg || q).mimetype || ''
  
  let [packname, author] = text ? text.split('|') : [null, null]
  
  let finalPackname = packname || m.pushName
  let finalAuthor = author || db.data?.setting?.packname || ''

  if (/image/.test(mime)) {
    let media = await imageToWebp(await q.download())
    await conn.message.send(m.chat, {
      type: 'sticker',
      media,
      mimetype: 'image/webp',
      packname: finalPackname,
      author: finalAuthor,
    }, { quote: m.raw })
  } else if (/video/.test(mime)) {
    if ((q.msg || q).seconds > 7) throw 'Maksimal 6 detik!'
    
    let media = await videoToWebp(await q.download())
    await conn.message.send(m.chat, {
      type: 'sticker',
      media,
      mimetype: 'image/webp',
      packname: finalPackname,
      author: finalAuthor,
    }, { quote: m.raw })
    
  } else {
    throw `Kirim Gambar/Video Dengan Caption ${usedPrefix + command}\nDurasi Video 1-6 Detik`
  }
}

handler.help = ['sticker']
handler.tags = ['maker']
handler.command = /^(stiker|s|sticker)$/i
handler.limit = false

export default handler

import axios from 'axios'

let handler = async (m, { conn, text, args, usedPrefix, command }) => {
    if (!args || !args[0]) throw `Example:\n${usedPrefix + command} https://www.instagram.com/reel/CZQsQveo-g8/`
    let url = args[0]
    let { key } = await conn.sendMessage(m.from, {text: 'Tunggu sebentar kak, sedang mengambil data...'})
    try {
        const base_url = 'https://api.instantdp.com/igdl'
        const options = {
         method: 'POST',
         url: base_url,
         headers:
         {
             'Content-Type': 'application/json',
             'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
             'Referer': 'https://www.instantdp.com/instagram'
         },
         data:
         {
             url: url
         }
        }
        let res = await axios(options)
        if (!res.data.success) throw res.data
        await conn.sendMessage(m.from, {text: `Mengirim video...`, edit: key })
        await conn.sendMedia(m.from, res.data.data[0].url, m, {caption: `Ini kak videonya`})
        } catch (e) {
        await conn.sendMessage(m.from, {text: `Gagal`, edit: key })
        console.log(e)
    }
}

handler.help = ['ig <url>']
handler.tags = ['downloader']
handler.command = /^(ig|igdl|instagram|instagramdl)$/i
handler.limit = 1
export default handler

import axios from 'axios'

const pickMediaUrl = (value) => {
    if (!value) return null
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = pickMediaUrl(item)
            if (nested) return nested
        }
        return null
    }
    if (typeof value === 'object') {
        return pickMediaUrl(value.url || value.downloadUrl || value.src || value.link || value._url || value.mediaUrl || value.file || value.video || value.image)
    }
    return null
}

const downloadMedia = async (url, fallbackMime = 'application/octet-stream') => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Gagal mengunduh media Instagram: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || fallbackMime
    return { buffer, contentType }
}

const sendMediaList = async (conn, from, list, quoted, caption = 'Instagram media') => {
    const mediaList = list.filter(Boolean)
    if (!mediaList.length) throw new Error('Tidak ada media yang berhasil diambil dari Instagram.')

    const maxItems = 3
    for (const item of mediaList.slice(0, maxItems)) {
        const mediaUrl = pickMediaUrl(item)
        if (!mediaUrl) continue

        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(String(mediaUrl)) || /video/i.test(String(item?.type || ''))
        const { buffer, contentType } = await downloadMedia(String(mediaUrl), isVideo ? 'video/mp4' : 'image/jpeg')
        await conn.sendMedia(from, buffer, quoted, {
            mimetype: isVideo ? (contentType.includes('video') ? contentType : 'video/mp4') : (contentType.includes('image') ? contentType : 'image/jpeg'),
            caption,
            asSticker: false,
        })
    }
}

let handler = async (m, { conn, args, usedPrefix, command }) => {
    if (!args || !args[0]) throw `Example:\n${usedPrefix + command} https://www.instagram.com/reel/CZQsQveo-g8/`

    const url = String(args[0]).trim()
    await conn.message.send(m.from, { type: 'text', text: 'Tunggu sebentar kak, sedang mengambil data...' }, { quote: m })

    try {
        const base_url = 'https://www.instantdp.com/api/instagram'
        const res = await axios({
            method: 'POST',
            url: base_url,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://www.instantdp.com/instagram'
            },
            data: { url }
        })

        const mediaList = Array.isArray(res?.data?.data) ? res.data.data : Array.isArray(res?.data?.result) ? res.data.result : []
        if (!mediaList.length) throw new Error('Link Instagram tidak valid atau tidak bisa diunduh saat ini.')

        await conn.message.send(m.from, { type: 'text', text: 'Mengirim...' }, { quote: m })
        await sendMediaList(conn, m.from, mediaList, m)
        return
    } catch (e) {
        try {
            const fallback = await axios({
                method: 'GET',
                url: `https://api.siputzx.my.id/api/d/sssinstagram?url=${encodeURIComponent(url)}`,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
                }
            })

            const fallbackList = Array.isArray(fallback?.data?.data?.url) ? fallback.data.data.url : [fallback?.data?.data?.url].filter(Boolean)
            await conn.message.send(m.from, { type: 'text', text: 'Mengirim...' }, { quote: m })
            await sendMediaList(conn, m.from, fallbackList, m)
            return
        } catch (err) {
            const response = await axios.get('https://api.betabotz.eu.org/api/download/igdowloader?', {
                params: { url, apikey: 'Btz-LtRHR' }
            })

            const mediaUrl = pickMediaUrl(response?.data?.message) || pickMediaUrl(response?.data?.data)
            if (!mediaUrl) throw 'Gagal mengunduh media dari Instagram. Coba link lain.'

            await conn.message.send(m.from, {
                type: /\.(mp4|mov|webm)(\?|$)/i.test(String(mediaUrl)) ? 'video' : 'image',
                media: String(mediaUrl),
                mimetype: /\.(mp4|mov|webm)(\?|$)/i.test(String(mediaUrl)) ? 'video/mp4' : 'image/jpeg',
                caption: 'Instagram media'
            }, { quote: m })
            return
        }
    }
}

handler.help = ['ig <url>']
handler.tags = ['downloader']
handler.command = /^(ig|igdl|instagram|instagramdl)$/i
handler.limit = 1
export default handler

import tiktok from '@tobyg74/tiktok-api-dl'

const downloadMedia = async (url, fallbackMime = 'application/octet-stream') => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Gagal mengunduh media dari URL: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || fallbackMime
    return { buffer, contentType }
}

var handler = async (m, { conn, args, usedPrefix, command }) => {
    if (!args || !args[0]) throw `Example:\n${usedPrefix + command} https://www.tiktok.com/@mewmeo062_/video/7553572796467596562`

    const url = String(args[0]).trim()
    await conn.message.send(m.from, { type: 'text', text: 'Tunggu sebentar kak, sedang mengambil data...' }, { quote: m })

    try {
        const res = await tiktok.Downloader(url, { version: 'v1' })
        const result = res?.result || res?.data || res || {}
        const type = result?.type || (Array.isArray(result?.images) ? 'image' : 'video')

        if (!result || (res?.status && res.status !== 'success')) {
            throw new Error('Gagal mengambil data TikTok. Coba link lain atau pastikan link valid.')
        }

        const caption = result?.desc || `ini kak ${type}nya`

        await conn.message.send(m.from, { type: 'text', text: `Mengirim ${type}...` }, { quote: m })

        if (type === 'video') {
            const videoUrl = Array.isArray(result?.video?.playAddr)
                ? result.video.playAddr[0]
                : result?.video?.playAddr || result?.video?.url || result?.video

            if (!videoUrl) throw new Error('URL video TikTok tidak ditemukan.')

            const ratio = result?.video?.ratio || 'unknown'
            const { buffer, contentType } = await downloadMedia(String(videoUrl), 'video/mp4')
            await conn.sendMedia(m.from, buffer, m, {
                mimetype: contentType.includes('video') ? contentType : 'video/mp4',
                caption: `${caption}\n\nresolusi: ${ratio}`,
                asSticker: false,
            })
        } else if (type === 'image') {
            const images = Array.isArray(result?.images) ? result.images : [result?.image || result?.url].filter(Boolean)
            if (!images.length) throw new Error('Gambar TikTok tidak ditemukan.')

            for (const img of images) {
                const { buffer, contentType } = await downloadMedia(String(img), 'image/jpeg')
                await conn.sendMedia(m.from, buffer, m, {
                    mimetype: contentType.includes('image') ? contentType : 'image/jpeg',
                    caption,
                    asSticker: false,
                })
            }
        }

        const music = result?.music
        const musicUrl = Array.isArray(music?.playUrl) ? music.playUrl[0] : music?.playUrl || music?.url
        const musicTitle = music?.title || 'Original sound'
        const musicAuthor = music?.author || 'TikTok'
        const coverLarge = Array.isArray(music?.coverLarge) ? music.coverLarge[0] : music?.coverLarge || music?.cover

        if (musicUrl) {
            let thumbnail = null
            if (coverLarge) {
                try {
                    thumbnail = await fetch(coverLarge).then(v => v.arrayBuffer()).then(buf => Buffer.from(buf))
                } catch {
                    thumbnail = null
                }
            }

            await conn.message.send(m.from, {
                type: 'audio',
                media: String(musicUrl),
                mimetype: 'audio/mp4',
                fileName: String(musicTitle),
                contextInfo: {
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        mediaType: 2,
                        mediaUrl: 'https://m.youtube.com/results?sp=mAEA&search_query=' + encodeURIComponent(musicTitle.replace(/original sound/i, 'suara asli')),
                        title: musicTitle.replace(/original sound/i, 'suara asli'),
                        body: musicAuthor,
                        sourceUrl: 'https://m.youtube.com/results?sp=mAEA&search_query=' + encodeURIComponent(musicTitle.replace(/original sound/i, 'suara asli')),
                        thumbnail
                    }
                }
            }, { quote: m })
        }
    } catch (e) {
        console.error('[ERROR] TikTok downloader failed:', e)
        throw 'Gagal, mungkin link tidak valid, private, atau API TikTok sedang berubah.'
    }
}

handler.help = ['tiktok <url>']
handler.tags = ['downloader']
handler.command = /^(tiktok|tiktokdl|tiktoknowm|tiktokwm|ttdl|ttnowm|tt|ttwm)$/i
handler.limit = 1
export default handler
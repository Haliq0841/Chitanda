import tiktok from '@tobyg74/tiktok-api-dl'

var handler = async (m, { conn, args, text, usedPrefix, command }) => {
    if (!args || !args[0]) throw `Example:\n${usedPrefix + command} https://www.tiktok.com/@mewmeo062_/video/7553572796467596562`
    let url = args[0]
    let { key } = await conn.sendMessage(m.from, {text: 'Tunggu sebentar kak, sedang mengambil data...'})
    try {
        let res = await tiktok.Downloader(url, { version: 'v1' })
        if (!res.status === 'success') throw e
        let caption = res.result.desc || `ini kak ${res.result.type}nya`
        await conn.sendMessage(m.from, {text: `Mengirim ${res.result.type}...`, edit: key });
        if (res.result.type === 'video') {
            caption += `\n\nresolusi: ${res.result.video.ratio}`
            await conn.sendMedia(m.from, res.result.video.playAddr[0], m, {caption: caption})
        } else if (res.result.type === 'image') {
            for (let img of res.result.images) {
                await conn.sendMedia(m.from, img, m)
            }
            m.reply(caption)
        }
        if (res.result.music.playUrl[0]) {
            await conn.sendMessage(m.from, { 
                audio: { 
                    url: res.result.music.playUrl[0]
                }, 
                mimetype: 'audio/mp4', fileName: `${res.result.music.title}`, contextInfo: { externalAdReply: {
                    mediaType: 1,
                    title: res.result.music.title.replace("original sound", "suara asli"),
                    body: res.result.music.author,
                    sourceUrl: 'https://m.youtube.com/results?sp=mAEA&search_query=' + res.result.music.title.replace("original sound", "suara asli"),
                    //thumbnailUrl: res.result.music.coverLarge[0],
                    thumbnail: new Uint8Array(await (await fetch(res.result.music.coverLarge[0])).buffer()),
                    renderLargerThumbnail: true
                }}
            }, { quoted: m })
        }
    } catch (e) {
        console.log(e)
        throw 'Gagal, mungkin link tidak valid atau private'
    }
}

handler.help = ['tiktok <url>']
handler.tags = ['downloader']
handler.command = /^(tiktok|tiktokdl|tiktoknowm|tiktokwm|ttdl|ttnowm|tt|ttwm)$/i
handler.limit = 1
export default handler
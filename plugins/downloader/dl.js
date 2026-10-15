import { YtDlp } from 'ytdlp-nodejs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const ytdlp = new YtDlp()
const tempDir = path.join(process.cwd(), 'temp')
const cookiePath = fileURLToPath(new URL('../../.ytdlp-cookies.txt', import.meta.url))
const directMediaLimit = 50 * 1024 * 1024

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

function getExtension(url) {
    try {
        return path.extname(new URL(url).pathname).toLowerCase()
    } catch {
        return ''
    }
}

function safeFileName(value) {
    const name = String(value || 'download').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim()
    return (name || 'download').slice(0, 120)
}

function getYtdlpOptions() {
    return {
        ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {}),
        ...(fs.existsSync(cookiePath) ? { cookies: cookiePath } : {})
    }
}

async function getDirectMedia(url) {
    let response
    try {
        response = await fetch(url, {
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 Chitanda Downloader' }
        })
    } catch {
        return null
    }

    if (!response.ok) return null

    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
    const extension = getExtension(url)
    const isMedia = /^(audio|video|image)\//.test(contentType)
        || /\.(3gp|avi|gif|jpeg|jpg|m4a|mkv|mov|mp3|mp4|ogg|png|wav|webm)$/i.test(extension)
    if (!isMedia) return null

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > directMediaLimit) {
        throw new Error(`Media langsung terlalu besar. Maksimal ${directMediaLimit / 1024 / 1024} MB.`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > directMediaLimit) throw new Error(`Media langsung terlalu besar. Maksimal ${directMediaLimit / 1024 / 1024} MB.`)

    return {
        buffer,
        extension,
        mimetype: contentType || 'application/octet-stream'
    }
}

async function downloadWithYtdlp(url, output) {
    await ytdlp.download(url, {
        ...getYtdlpOptions(),
        format: 'bestvideo+bestaudio/best',
        output,
        mergeOutputFormat: 'mp4'
    })
}

async function downloadMedia(url) {
    const directMedia = await getDirectMedia(url)
    if (directMedia) {
        return {
            source: directMedia.buffer,
            mimetype: directMedia.mimetype,
            fileName: `download${directMedia.extension}`,
            cleanup: async () => {}
        }
    }

    const outputPath = path.join(tempDir, `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`)
    try {
        await downloadWithYtdlp(url, outputPath)
        if (!fs.existsSync(outputPath)) throw new Error('gagal menghasilkan file media.')
        return {
            source: outputPath,
            mimetype: 'video/mp4',
            fileName: `${safeFileName('download')}.mp4`,
            cleanup: async () => fs.promises.rm(outputPath, { force: true }).catch(() => {})
        }
    } catch (error) {
        await fs.promises.rm(outputPath, { force: true }).catch(() => {})
        throw error
    }
}

const handler = async (m, { conn, args, usedPrefix }) => {
    const url = String(args?.[0] || '').trim()
    if (!/^https?:\/\//i.test(url)) {
        throw `Masukkan link media yang valid!\nContoh:\n${usedPrefix}dl https://contoh.com/video.mp4`
    }

    const status = await m.reply('Tunggu kak, sedang memproses link...')
    let outputPath

    try {
        await status.edit('Memproses media sosial...')
        const media = await downloadMedia(url)
        outputPath = typeof media.source === 'string' ? media.source : null
        await status.edit('Sedang mengirim...')
        await conn.sendMedia(m.from, media.source, m, {
            mimetype: media.mimetype,
            fileName: media.fileName,
            caption: 'Berhasil diunduh'
        })
        await media.cleanup()
    } catch (error) {
        await status.edit(`Gagal mengunduh: ${error?.message || error}`)
        throw error
    } finally {
        if (outputPath) await fs.promises.rm(outputPath, { force: true }).catch(() => {})
    }
}

handler.help = ['dl <url> - Mengunduh media dari berbagai sumber.']
handler.tags = ['downloader']
handler.command = /^dl$/i
handler.limit = 1
handler.download = downloadMedia

export default handler

import { YtDlp } from 'ytdlp-nodejs';
import fs from 'fs';
import path from 'path';

const ytdlp = new YtDlp();
const cookiePath = (new URL('../../.ytdlp-cookies.txt', import.meta.url)).pathname;
const tmpDir = path.join(__dirname, './temp');

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractVideoId(text) {
    const match = text?.match(YT_REGEX);
    return match ? match[1] : null;
}

function getCookies() {
    return fs.existsSync(cookiePath) ? cookiePath : undefined;
}

async function getVideoInfo(videoId) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    return await ytdlp.getInfo(url, { cookies: getCookies() });
}

async function searchVideos(query, limit = 10) {
    const results = await ytdlp.exec(`ytsearch${limit}:${query}`, {
        cookies: getCookies(),
        flatPlaylist: true,
        dumpSingleJson: true
    });
    return results?.entries || (Array.isArray(results) ? results : [results]);
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViews(viewCount) {
    if (!viewCount) return '0';
    if (viewCount >= 1e9) return (viewCount / 1e9).toFixed(1) + 'B';
    if (viewCount >= 1e6) return (viewCount / 1e6).toFixed(1) + 'M';
    if (viewCount >= 1e3) return (viewCount / 1e3).toFixed(1) + 'K';
    return viewCount.toString();
}

const handler = async (m, { conn, args, isOwner, text, __dirname, thisClass, usedPrefix, command }) => {
    const query = text?.trim();

    switch (command) {
        case 'ytmp3':
        case 'ytmusic':
        case 'ytmusik':
        case 'play': {
            let videoId = extractVideoId(query);
            let info = null;

            if (!videoId) {
                if (!args[0]) throw `Masukkan link youtube atau kata kunci pencarian!\nContoh:\n${usedPrefix}${command} judul lagu`;
                await conn.message.send(m.from, { type: 'text', text: 'Tunggu kak, sedang menelusuri...' }, { quote: m });
                const results = await searchVideos(query, 5);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;
                videoId = results[0].id;
                info = results[0];
            } else {
                await conn.message.send(m.from, { type: 'text', text: 'Tunggu kak, sedang mengambil data...' }, { quote: m });
            }

            try {
                if (!info) {
                    const videoInfo = await getVideoInfo(videoId);
                    info = videoInfo;
                }

                const title = info.title || 'Audio';
                const duration = info.duration ? formatDuration(info.duration) : '';
                const uploadDate = info.upload_date ? `${info.upload_date.slice(6, 8)}/${info.upload_date.slice(4, 6)}/${info.upload_date.slice(0, 4)}` : '';
                const caption = `${title}${duration ? `\nDurasi: ${duration}` : ''}${uploadDate ? `\nDiupload: ${uploadDate}` : ''}`;

                await conn.message.send(m.from, { type: 'text', text: `Berhasil Menemukan *${title}*,\nSedang mendownload...` }, { quote: m });

                const url = `https://www.youtube.com/watch?v=${videoId}`;
                const mp3Buffer = await ytdlp.stream(url, {
                    cookies: getCookies(),
                    filter: 'audioonly',
                    type: 'mp3'
                }).toBuffer();

                await conn.message.send(m.from, { type: 'text', text: `Mengirim...` }, { quote: m });
                await conn.message.send(m.from, {
                    type: 'audio',
                    media: mp3Buffer,
                    mimetype: 'audio/mpeg'
                }, { quote: m });
                await conn.message.send(m.from, { type: 'text', text: caption }, { quote: m });
            } catch (e) {
                await conn.message.send(m.from, { type: 'text', text: `Gagal: ${e.message}` }, { quote: m });
                throw e;
            }
            break;
        }

        case 'ytmp4':
        case 'ytvideo':
        case 'ytv':
        case 'ythd': {
            const [searchQuery, resolusi] = query ? query.split('|') : ['', ''];
            let videoId = extractVideoId(searchQuery);
            let info = null;

            if (!videoId) {
                if (!args[0]) throw `Masukkan link youtube atau kata kunci pencarian!\nContoh:\n${usedPrefix}${command} judul|480p\natau\n${usedPrefix}${command} https://youtu.be/xxxxxx|480p`;
                await conn.message.send(m.from, { type: 'text', text: 'Tunggu kak, sedang menelusuri...' }, { quote: m });
                const results = await searchVideos(searchQuery, 5);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + searchQuery;
                videoId = results[0].id;
                info = results[0];
            } else {
                await conn.message.send(m.from, { type: 'text', text: 'Tunggu kak, sedang mengambil data...' }, { quote: m });
            }

            try {
                if (!info) {
                    const videoInfo = await getVideoInfo(videoId);
                    info = videoInfo;
                }

                const title = info.title || 'Video';
                const author = info.uploader || info.channel || 'Tidak diketahui';
                const duration = info.duration ? formatDuration(info.duration) : 'Tidak diketahui';
                const views = formatViews(info.view_count);
                const uploadDate = info.upload_date ? `${info.upload_date.slice(6, 8)}/${info.upload_date.slice(4, 6)}/${info.upload_date.slice(0, 4)}` : 'Tidak diketahui';
                const description = info.description || '';
                const url = `https://www.youtube.com/watch?v=${videoId}`;

                let cap = `*${title}*\n\n` +
                    `*Author:* ${author}\n` +
                    `*Durasi:* ${duration}\n` +
                    `*Diupload:* ${uploadDate}\n` +
                    `*Views:* ${views}\n` +
                    `*Link:* ${url}\n\n` +
                    `${description}`;

                await conn.message.send(m.from, { type: 'text', text: `Berhasil Menemukan *${title}*,\nSedang mendownload...` }, { quote: m });

                const quality = resolusi ? resolusi.replace(/[^0-9]/g, '') : '720';
                const outputPath = path.join(tmpDir, `${videoId}_${Date.now()}.mp4`);

                await ytdlp.download(url, {
                    cookies: getCookies(),
                    format: `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`,
                    output: outputPath,
                    mergeOutputFormat: 'mp4'
                });

                const fileSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);

                await conn.message.send(m.from, { type: 'text', text: `Berhasil Mengunduh *${title}*\nSize: ${fileSize} MB,\nSedang Mengirim...` }, { quote: m });

                await conn.message.send(m.from, {
                    type: 'video',
                    media: outputPath,
                    mimetype: 'video/mp4',
                    caption: cap,
                    jpegThumbnail: info.thumbnail ? await fetch(info.thumbnail).then(v => v.arrayBuffer()).then(buf => Buffer.from(buf)).catch(() => undefined) : undefined
                }, { quote: m });

                fs.unlinkSync(outputPath);
            } catch (e) {
                await conn.message.send(m.from, { type: 'text', text: `Gagal: ${e.message}` }, { quote: m });
                throw e;
            }
            break;
        }

        case 'yts': {
            if (!args[0]) throw `Masukkan kata kunci pencarian!\nContoh:\n${usedPrefix}${command} judul lagu`;
            await conn.message.send(m.from, { type: 'text', text: 'Tunggu kak, sedang menelusuri...' }, { quote: m });

            try {
                const results = await searchVideos(query, 10);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;

                let msg = `*Hasil Pencarian YouTube: ${query}*\n\n`;
                results.forEach((v, i) => {
                    msg += `${i + 1}. *${v.title || 'Unknown'}*\n`;
                    msg += `   Channel: ${v.uploader || v.channel || 'Unknown'}\n`;
                    msg += `   Durasi: ${v.duration ? formatDuration(v.duration) : '-'}\n`;
                    msg += `   Link: https://www.youtube.com/watch?v=${v.id}\n\n`;
                });
                msg += `\nUntuk download, ketik:\n${usedPrefix}play <link/judul>\n${usedPrefix}ytmp4 <link/judul>`;

                await conn.message.send(m.from, { type: 'text', text: msg }, { quote: m });
            } catch (e) {
                await conn.message.send(m.from, { type: 'text', text: `Gagal: ${e.message}` }, { quote: m });
                throw e;
            }
            break;
        }

        case 'ytinfo': {
            let videoId = extractVideoId(query);
            if (!videoId) {
                if (!args[0]) throw `Masukkan link youtube atau kata kunci pencarian!\nContoh:\n${usedPrefix}${command} https://youtu.be/xxxxxx`;
                await conn.message.send(m.from, { type: 'text', text: 'Tunggu kak, sedang menelusuri...' }, { quote: m });
                const results = await searchVideos(query, 1);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;
                videoId = results[0].id;
            }

            try {
                const info = await getVideoInfo(videoId);
                const title = info.title || 'Unknown';
                const author = info.uploader || info.channel || 'Tidak diketahui';
                const duration = info.duration ? formatDuration(info.duration) : '-';
                const views = formatViews(info.view_count);
                const uploadDate = info.upload_date ? `${info.upload_date.slice(6, 8)}/${info.upload_date.slice(4, 6)}/${info.upload_date.slice(0, 4)}` : '-';
                const likes = info.like_count ? formatViews(info.like_count) : '-';
                const description = info.description || '';

                let msg = `*${title}*\n\n` +
                    `*Author:* ${author}\n` +
                    `*Durasi:* ${duration}\n` +
                    `*Views:* ${views}\n` +
                    `*Likes:* ${likes}\n` +
                    `*Diupload:* ${uploadDate}\n` +
                    `*Link:* https://www.youtube.com/watch?v=${videoId}\n\n` +
                    `${description.substring(0, 500)}${description.length > 500 ? '...' : ''}`;

                await conn.message.send(m.from, {
                    type: 'image',
                    media: info.thumbnail,
                    caption: msg,
                    mimetype: 'image/jpeg'
                }, { quote: m });
            } catch (e) {
                await conn.message.send(m.from, { type: 'text', text: `Gagal: ${e.message}` }, { quote: m });
                throw e;
            }
            break;
        }

        case 'tesyt': {
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            if (!args[0]) throw `Masukkan link youtube!\nContoh:\n${usedPrefix}${command} https://youtu.be/xxxxxx`;

            try {
                const videoId = extractVideoId(query);
                if (!videoId) throw 'Link tidak valid';

                const info = await getVideoInfo(videoId);
                const formats = info.formats || [];

                let msg = `*Test Format: ${info.title}*\n\n`;
                const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.acodec === 'none').slice(0, 10);
                const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none').slice(0, 5);

                msg += `*Video Formats:*\n`;
                videoFormats.forEach(f => {
                    msg += `- ${f.format_id}: ${f.height}p (${f.ext}) ~${f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + 'MB' : 'unknown'}\n`;
                });

                msg += `\n*Audio Formats:*\n`;
                audioFormats.forEach(f => {
                    msg += `- ${f.format_id}: ${f.abr || '?'}kbps (${f.ext}) ~${f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + 'MB' : 'unknown'}\n`;
                });

                m.reply(msg);
            } catch (e) {
                m.reply(`Gagal: ${e.message}`);
                throw e;
            }
            break;
        }

        case 'setytcookie': {
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            const cookie = m.quoted ? m.quoted.msg.text : text ?? undefined;
            if (!cookie) throw `Silahkan reply pesan yang berisi cookie atau ketik ${usedPrefix}setytcookie cookie`;
            fs.writeFileSync(cookiePath, `${cookie}`);
            m.reply('Berhasil menyimpan cookie .ytdlp-cookies.txt');
            return thisClass.loadPlugin((new URL(import.meta.url)).pathname);
        }
    }
};

handler.command = /^tesyt|yts|ytinfo|setytcookie|ytmp3|play|ytmp4|ytvideo|ytv|ythd$/i;
handler.tags = ['downloader'];
handler.help = ['play', 'ytmp3', 'ytmp4', 'ytvideo', 'ythd url atau judul|resolusi', 'yts pencarian', 'ytinfo link', 'tesyt link (owner)'];
export default handler;
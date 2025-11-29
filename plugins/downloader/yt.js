import { unixTimestampSeconds } from 'baileys'
import fs from 'fs'
import path from 'path'
import { Innertube, UniversalCache, YTNodes, Parser, Utils, Platform } from 'youtubei.js'
import vm from 'node:vm';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

Platform.shim.eval = async (data, env) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }
  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `
    (function() {
      ${data.output}
      return { ${properties.join(', ')} };
    })()
  `;

  const context = { exportedVars: {} };
  const script = new vm.Script(code);
  return script.runInNewContext(context);
};

let mess = null;
let isLogin = false;
const credentialsPath = (new URL('../../.credentials.json', import.meta.url)).pathname;
const cookiePath = (new URL('../../.yt-cookie.txt', import.meta.url)).pathname;
let client_type = 'WEB'; //WEB, ANDROID, TV, YTMUSIC. untuk masuk dengan credentials hanya bisa menggunkan client tv (akses sangat terbatas)
const yt = await Innertube.create({
    client_type: client_type,
    lang: 'id',
    //location: 'id',
    cookie: client_type !== 'TV' && fs.existsSync(cookiePath) ? fs.readFileSync(cookiePath, 'utf-8') : undefined
});
    yt.session.on('update-credentials', ({ credentials }) => {
        console.log('Token diperbarui otomatis, simpan ulang ke file.');
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
    });
    yt.session.on('auth-pending', (data) => {
        console.log('Buka URL ini:', data.verification_url);
        console.log('Masukkan kode ini:', data.user_code);
        if (mess) mess.reply('Buka URL ini:\n' + data.verification_url + '\n\nMasukkan kode ini:\n' + data.user_code);
    });
    yt.session.on('auth', ({ credentials }) => {
        isLogin = true;
        console.log('Login berhasil, menyimpan kredensial...');
        if (mess) mess.reply('Login berhasil!');
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
    });

const handler = async (m, { conn, args, isOwner, text, __dirname, thisClass, usedPrefix, command }) => {
    if (!isLogin && client_type === 'TV') {
        if (fs.existsSync(credentialsPath)) {
            const savedCreds = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
            await yt.session.signIn(savedCreds);
            console.log('Masuk dengan kredensial tersimpan (TV client).');
            isLogin = true;
        } else {
            if (!isOwner) throw 'Belum ada akun youtube silahkan minta owner untuk login dengan akun youtube terlebih dahulu';
            mess = m;
            await yt.session.signIn();
        }
    } else if (client_type !== 'TV') {
        if (command == 'setytcookie') {
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            const cookie =  m.quoted ?  m.quoted.msg.text : text ?? undefined
            if (!cookie) throw `Silahkan reply pesan yang berisi cookie atau ketik ${usedPrefix}setytcookie cookie`;
            fs.writeFileSync(cookiePath, `${cookie}`);
            m.reply('Berhasil menyimpan cookie .yt-cookie.txt');
            return thisClass.loadPlugin((new URL(import.meta.url)).pathname)
        } else if (!fs.existsSync(cookiePath)) {
            if (!isOwner) throw 'Belum ada cookie youtube silahkan minta owner untuk menambahkan cookie terlebih dahulu';
            return m.reply(`Silahkan tambahkan cookie youtube di file .yt-cookie.txt\nKetik ${usedPrefix}setytcookie <reply cookie>\n\nCara mendapatkan cookie:\n1. Buka browser (untuk Android bisa gunakan MS Edge)\n2. Klik titik 3 atau toolbar cari menu Extensi, install cookie-editor\n3. Buka youtube.com (Di sarankan menggunakan mode penyamaran)\n4.login dengan akun google kamu\n5. Setelah berhasil login buka salah satu video dulu, buka cookie-editor, lalu export cookie dalam format Header-String\n6. Salin semua isinya dan ketik ${usedPrefix}setytcookie <paste disini/reply pesan berisi cookie>`);
        } else {
            isLogin = true;
        }
    }
    switch (command) {
        case 'ytmp3':
        case 'ytmusic':
        case 'ytmusik':
        case 'play':
            let url = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            let key;
            let published;
            if (!url) {
                if (args[0]) {
                    key = (await conn.sendMessage(m.from, {text: 'Tunggu kak, sedang menelusuri...'})).key;
                    let { results } = await yt.search(text);
                    if (results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + text;
                    let video = results.find(video => video.type.toLowerCase() === 'video');
                    if (!video) throw 'Tidak ditemukan hasil untuk: ' + text;
                    url = [
                        '', video.id
                    ]
                    published = video.published?.text;
                } else {
                    throw 'Masukkan link youtube atau kata kunci pencarian!';
                }
            } else {
                key = (await conn.sendMessage(m.from, {text: 'Tunggu kak, sedang mengambil data...'})).key;
            }
            let videoId = url[1];
            if (!videoId) throw 'Link tidak valid, pastikan linknya benar';
            url = `https://www.youtube.com/watch?v=${videoId}`;
            try {
                const { basic_info } = await yt.music.getInfo(videoId);
                let caption = `${basic_info.title}`;
                if (published)
                    caption += `\nDiupload: ${published}`
                else
                    caption += `\nDurasi: ${formatDuration(basic_info.duration)}`;
                await conn.sendMessage(m.from, {text: `Berhasil Menemukan *${basic_info.title}*,\nSedang mendownload...`, edit: key });
                const stream = await yt.download(`${videoId}`, {
                    type: 'audio',
                    quality: 'best',
                    format: 'mp4',
                    client: 'YTMUSIC'
                });
                const inputStream = new PassThrough();
                for await (const chunk of Utils.streamToIterable(stream)) {
                  inputStream.write(chunk);
                }
                inputStream.end();
                await conn.sendMessage(m.from, {text: `lagu *${basic_info.title}* selesai di download, sedang konversi ke format mp3...`, edit: key });
                const chunks = [];
                await new Promise((resolve, reject) => {
                  ffmpeg(inputStream)
                    .format('mp3')
                    .on('error', reject)
                    .on('end', resolve)
                    .pipe()
                    .on('data', chunk => chunks.push(chunk));
                });
                const mp3Buffer = Buffer.concat(chunks);
                await conn.sendMessage(m.from, {text: `Mengirim...`, edit: key });
                await conn.sendMessage(m.from, { 
                audio: mp3Buffer, 
                mimetype: 'audio/mpeg', fileName: `${basic_info.title}.mp3`, contextInfo: {
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        mediaType:  2,
                        mediaUrl: url,
                        title: caption ,
                        body: basic_info.author,
                        sourceUrl: url,
                        thumbnail: await fetch(basic_info.thumbnail[0].url).then(v => v.arrayBuffer()).then(buf => Buffer.from(buf))
                    }
                }
            }, { quoted: m })
            } catch (e) {
                await conn.sendMessage(m.from, {text: `Gagal`, edit: key });
                throw e
            }
        break
        case 'yts':
            let res = await yt.search(text, {

            })
            throw res.results
        break
        case 'ytinfo':
            const videoInfo = await yt.actions.execute('/player', {
    // You can add any additional payloads here, and they'll merge with the default payload sent to InnerTube.
                videoId: text,
                client: 'YTMUSIC', // InnerTube client to use.
                parse: true // tells YouTube.js to parse the response (not sent to InnerTube).
           });
            m.reply(JSON.stringify(videoInfo, null, 2));
        break
    }
}

handler.command = /^yts|ytinfo|setytcookie|ytmp3|play$/i
handler.help = ['play', 'ytmp3']
handler.tags = ['downloader']

export default handler

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  // tambahkan leading zero untuk detik < 10
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
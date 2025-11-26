import { unixTimestampSeconds } from 'baileys'
import fs from 'fs'
import path from 'path'
import { Innertube, UniversalCache, YTNodes, Parser } from 'youtubei.js'

let mess = null;
let isLogin = false;
const credentialsPath = (new URL('../../.credentials.json', import.meta.url)).pathname;
const cookiePath = (new URL('../../.yt-cookie.txt', import.meta.url)).pathname;
let client_type = 'WEB'; //WEB, ANDROID, TV, YTMUSIC. untuk masuk dengan credentials hanya bisa menggunkan client tv (akses sangat terbatas)
const yt = await Innertube.create({
    client_type: client_type,
    lang: 'id',
    location: 'id',
    cookie: client_type === 'TV' && fs.existsSync(cookiePath) ? fs.readFileSync(cookiePath, 'utf-8') : undefined
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
    } else if (!isLogin && client_type !== 'TV') {
        if (!fs.existsSync(cookiePath)) {
            if (!isOwner) throw 'Belum ada cookie youtube silahkan minta owner untuk menambahkan cookie terlebih dahulu';
            return m.reply(`Silahkan tambahkan cookie youtube di file .yt-cookie.txt\nKetik ${usedPrefix}setytcookie <reply cookie>\n\nCara mendapatkan cookie:\n1. Buka browser (untuk Android bisa gunakan MS Edge)\n2. Klik titik 3 atau toolbar cari menu Extensi, install cookie-editor\n3. Buka youtube.com (Di sarankan menggunakan mode penyamaran)\n4.login dengan akun google kamu\n5. Setelah berhasil login buka salah satu video dulu, buka cookie-editor, lalu export cookie dalam format Header-String\n6. Salin semua isinya dan ketik ${usedPrefix}setytcookie <paste disini/reply pesan berisi cookie>`);
        }
        isLogin = true;
    }
    if (!text) throw `url YT nya mana?\nexample: ${usedPrefix + command} url`
    switch (command) {
        case 'setytcookie':
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            const cookie =  m.quoted ?  m.quoted.msg.text : text ?? undefined
            if (!cookie) throw `Silahkan reply pesan yang berisi cookie atau ketik ${usedPrefix}setytcookie cookie`;
            fs.writeFileSync(cookiePath, cookie);
            m.reply('Berhasil menyimpan cookie .yt-cookie.txt');
            thisClass.loadPlugin((new URL(import.meta.url)).pathname)
        break
        case 'ytmp3':
        case 'ytmusic':
        case 'ytmusik':
            let url = args[0]
            try {
            } catch (e) {

            }
        break
        case 'yts':
            let res = await yt.search(text)
            m.reply(res);
        break
        case 'ytinfo':
            const videoInfo = await yt.actions.execute('/player', {
    // You can add any additional payloads here, and they'll merge with the default payload sent to InnerTube.
                videoId: text,
                client: 'YTMUSIC', // InnerTube client to use.
                parse: true // tells YouTube.js to parse the response (not sent to InnerTube).
           });
            m.reply(videoInfo);

        break
    }
}

handler.command = /^yts|ytinfo$/i
handler.help = ['yt <url>']
handler.tags = ['downloader']

export default handler

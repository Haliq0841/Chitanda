import { unixTimestampSeconds } from 'baileys'
import fs from 'fs'
import path from 'path'
import { Innertube, UniversalCache, YTNodes, Parser } from 'youtubei.js'

let mess = null;
let isLogin = false;
const credentialsPath = (new URL('../../.credentials.json', import.meta.url)).pathname;
const yt = await Innertube.create({ client_type: 'TV', cache: new UniversalCache(), parser: Parser.with(YTNodes) });
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

const handler = async (m, { conn, args, isOwner, text, __dirname, usedPrefix, command }) => {
    if (!isLogin) {
        if (fs.existsSync(credentialsPath)) {
            const savedCreds = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
            await yt.session.signIn(savedCreds);
            console.log('Masuk dengan kredensial tersimpan (TV client).');
            isLogin = true;
        } else {
            if (!isOwner) throw 'Belum ada akun youtube silahkan minta owner untuk sig in dengan akun youtube terlebih dahulu';
            mess = m;
            await yt.session.signIn();
        }
    }
    
    if (!text) throw `url YT nya mana?\nexample: ${usedPrefix + command} url`
    switch (command) {
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
        case 'gethomefeed':
            let feed = await yt.getGuide();
            m.reply(JSON.stringify(feed, null, 2));
        break
    }
}

handler.command = /^yts|gethomefeed$/i
handler.help = ['yt <url>']
handler.tags = ['downloader']

export default handler

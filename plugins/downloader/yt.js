import fs from 'fs'
import path from 'path'
import ytdl from 'ytdl-core-enhanced'

const handler = async (m, { conn, args, isOwner, text, __dirname, usedPrefix, command }) => {
    if (!text) throw `url YT nya mana?\nexample: ${usedPrefix + command} url`
    const cookiePath = path.join(__dirname, '.ytdl-cookie.txt')
    if (command.toLowerCase() == 'updateytcookie') {
        /*
For 403 Forbidden Error, age-restricted, region-locked, or member-only videos, you need to provide YouTube cookies from a logged-in account.

### Method 1: Using Cookie Editor Extension (Recommended)

1. Install [Cookie-Editor](https://cookie-editor.com/) extension for your browser:
   - [Chrome/Edge/Kiwi Browser(android)](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)

2. Go to [YouTube](https://www.youtube.com) and log in to your account (private mode Recommended)

3. Click the Cookie-Editor extension icon

4. Click "Export" → "Header String" (this copies cookie string to clipboard)

5. Use the cookie with command .updateYtCookie with reply your cookie message
        */
        if (!isOwner) return !0
        if (!m.quoted?.body) throw `Balas pesan yang berisi cookie!`
        const cookieString = `${m.quoted.body}`
        fs.writeFileSync(cookiePath, cookieString)
        return m.reply('Cookie berhasil diupdate!\n' + cookiePath)
    } //**Cookie Lifespan**: YouTube cookies typically last 1-2 weeks. If downloads start failing with 403 errors, refresh your cookies.
    const cookieString = fs.existsSync(cookiePath) ? fs.readFileSync(cookiePath, 'utf-8') : ''
    let { key } = await conn.sendMessage(m.from, {text: 'Tunggu sebentar kak, sedang mengambil data...'})
    const agent = {
        requestOptions: {
            headers: {
                'Cookie': cookieString
            }
        }
    }

    const processMP3 = async ({url, quality}) => {
        const Options = {
            quality: 'highest',
            filter: 'audioonly',
            ...agent
        }
        return await new Promise((resolve, reject) => {
            const audio = ytdl(url, Options)

        })
    }
    switch (command) {
        case 'ytmp3':
        case 'ytmusic':
        case 'ytmusik':
            let url = args[0]
            try {
                let res = await ytdl.getInfo(url)
                let audio = await ytdl(url, { quality: 'highestaudio', filter: 'audioonly' })
            } catch (e) {

            }
    }
}

handler.command = /^updateytcookie$/i
handler.help = ['yt <url>']
handler.tags = ['downloader']

export default handler

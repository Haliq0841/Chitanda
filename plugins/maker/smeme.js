import fs from "fs";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

try {
    GlobalFonts.registerFromPath('./impact.ttf', 'Impact');
    GlobalFonts.registerFromPath('./NotoColorEmoji-Regular.ttf', 'Emoji');
} catch (e) {
    console.log("Font tidak ditemukan, lewati registrasi.");
}

let handler = async (m, { conn, db, text, usedPrefix, command }) => {
    if (!text) throw `Gunakan format: ${usedPrefix + command} teks atas|teks bawah\n\nContoh:\n${usedPrefix + command} atas 🗿|bawah 🔥`;

    let [topText, bottomText] = text.split("|");

    let q = m.quoted ? m.quoted : m;
    let mime = (q.msg || q).mimetype || '';
    if (!/image/.test(mime)) throw `Kirim/Balas Gambar Dengan Perintah *${usedPrefix + command}*`;

    m.react('⏳')

    try {
        let media = await q.download();
        const image = await loadImage(media);

        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.textAlign = 'center';

        let fontSize = Math.floor(canvas.width / 9);
        ctx.font = `bold ${fontSize}px Impact, Emoji`; 
        ctx.textBaseline = 'top'; 

        let maxWidth = canvas.width * 0.95; 
        let lineHeight = fontSize * 1.15; 

        const wrapText = (txt) => {
            if (!txt || txt.trim() === '') return [];
            txt = txt.trim();
            let words = txt.split(' ');
            let lines = [];
            let currentLine = words[0];

            for (let i = 1; i < words.length; i++) {
                let word = words[i];
                let width = ctx.measureText(currentLine + " " + word).width;
                if (width < maxWidth) {
                    currentLine += " " + word;
                } else {
                    lines.push(currentLine);
                    currentLine = word;
                }
            }
            lines.push(currentLine);
            return lines;
        };

        const drawLines = (lines, startY) => {
            ctx.lineWidth = Math.floor(fontSize / 8);
            
            for (let i = 0; i < lines.length; i++) {
                let y = startY + (i * lineHeight);
                let randomOffsetX = (Math.random() - 0.5) * 15; 
                let randomOffsetY = (Math.random() - 0.5) * 20;

                ctx.strokeText(lines[i], (canvas.width / 2) + randomOffsetX, y + randomOffsetY);
                ctx.fillText(lines[i], (canvas.width / 2) + randomOffsetX, y + randomOffsetY);
            }
        };
        // --------------------------------------------------------

        let topLines = wrapText(topText);
        if (topLines.length > 0) {
            let topY = fontSize * 0.1; 
            drawLines(topLines, topY);
        }

        let bottomLines = wrapText(bottomText);
        if (bottomLines.length > 0) {
            let totalHeight = bottomLines.length * lineHeight;
            let bottomY = canvas.height - totalHeight - (fontSize * 0.1); 
            drawLines(bottomLines, bottomY);
        }

        let buffer = await canvas.toBuffer('image/jpeg');

        await conn.sendImageAsSticker(m.chat, buffer, m, { 
            packname: m.pushName, 
            author: db.data.setting.packname 
        });
        m.react('✅')

    } catch (e) {
        console.error(e);
        throw 'Terjadi kesalahan saat memproses gambar meme: ' + e;
    }
}

handler.help = ['smeme'];
handler.tags = ['maker'];
handler.command = /^(smeme)$/i;
handler.limit = 1;

export default handler;

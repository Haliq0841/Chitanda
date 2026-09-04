import FormData from "form-data";
import { Jimp } from "jimp";
import axios from "axios";

const pickResultUrl = (payload) => {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = pickResultUrl(item)
      if (nested) return nested
    }
    return null
  }
  if (typeof payload === 'object') {
    return pickResultUrl(payload.url || payload.downloadUrl || payload.image || payload.image_url || payload.output || payload.bgRemoved || payload.data || payload.result)
  }
  return null
}

const handler = async (m, { conn, usedPrefix, command, args }) => {
  const q = m.quoted ? m.quoted : m;
  const mime = (q.msg || q).mimetype || q.mediaType || "";

  if (!mime) {
    throw `Fotonya Mana Kak?\nEx: \`${usedPrefix + command} 4\` (reply/kirim foto)\n\nNote: Angka size yang tersedia (2, 4, 6, 8, 16), default 2`;
  }

  if (!/image\/(jpe?g|png|webp)/.test(mime)) {
    throw `Mime ${mime} tidak didukung! Pastikan mengirim gambar.`;
  }

  let size = 2;
  if (args[0]) {
    if (!/^(2|4|6|8|16)$/.test(args[0].toString())) {
      throw "Ukuran yang tersedia hanya 2, 4, 6, 8, 16 dan harus berupa angka!";
    }
    size = parseInt(args[0]);
  }

  const isAnime = args[1]?.toLowerCase() === "anime" || args[0]?.toLowerCase() === "anime";

  await m.reply(`Sedang memproses gambar (Upscale: ${size}x)... Mohon tunggu sebentar.`);

  const mediaBuffer = await q.download?.() || await conn.downloadMediaMessage?.(q) || await conn.downloadMediaMessage?.(q, 'remini')
  if (!mediaBuffer) throw new Error("Gagal mengunduh gambar dari WhatsApp.");

  const resultUrl = await upscale(mediaBuffer, size, isAnime);
  const response = await fetch(resultUrl);
  if (!response.ok) throw new Error('Gagal mengunduh hasil proses image dari server.');
  const outputBuffer = Buffer.from(await response.arrayBuffer());

  await conn.sendMedia(m.chat, outputBuffer, m, {
    mimetype: 'image/png',
    caption: `✨ *Berhasil dijernihkan!*\n📐 *Ukuran Scale:* ${size}x`,
    asSticker: false,
  });
};

handler.help = ['remini <size>', 'hd2 <size>', 'jernih2 <size>'];
handler.tags = ['ai', 'tools'];
handler.command = /^(remini|hd2|jernih2)$/i;
handler.register = false;
handler.limit = 1;
handler.disable = false;

export default handler;

async function upscale(buffer, size = 2, anime = false) {
  return new Promise((resolve, reject) => {
    if (!buffer || !Buffer.isBuffer(buffer)) return reject(new Error("Input buffer tidak valid!"));
    if (!/^(2|4|6|8|16)$/.test(size.toString())) return reject(new Error("Ukuran upscale tidak valid!"));

    Jimp.read(Buffer.from(buffer))
      .then(image => {
        const { width, height } = image.bitmap;
        const newWidth = width * size;
        const newHeight = height * size;

        const timestamp = Date.now();
        const form = new FormData();
        form.append("name", "upscale-" + timestamp);
        form.append("imageName", "upscale-" + timestamp);
        form.append("desiredHeight", newHeight.toString());
        form.append("desiredWidth", newWidth.toString());
        form.append("outputFormat", "png");
        form.append("compressionLevel", "none");
        form.append("anime", anime.toString());
        form.append("image_file", buffer, {
          filename: "upscale-" + timestamp + ".png",
          contentType: 'image/png',
        });

        axios.post("https://api.upscalepics.com/upscale-to-size", form, {
          headers: {
            ...form.getHeaders(),
            origin: "https://upscalepics.com",
            referer: "https://upscalepics.com"
          },
          responseType: 'json'
        })
        .then(res => {
          const url = pickResultUrl(res?.data)
          if (!url) {
            return reject(new Error("Gagal memproses gambar dari API Upscalepics!"));
          }
          resolve(url)
        })
        .catch(reject);
      })
      .catch(err => reject(new Error(`Gagal membaca metadata gambar via Jimp: ${err.message || err}`)));
  });
}

import FormData from "form-data";
import { Jimp } from "jimp";
import axios from "axios";

let handler = async (m, {
    conn,
    usedPrefix,
    command,
    args
}) => {
    ///conn.hdr = conn.hdr ? conn.hdr : {};
    const sender = m.sender.split(`@`)[0];


    let q = m.quoted ? m.quoted : m;
    let mime = (q.msg || q).mimetype || q.mediaType || "";

    if (!mime)
        throw `Fotonya Mana Kak?\nEx: \`${usedPrefix + command} size\` reply foto atau kasih caption di foto\n\nNote: angka size yang tersedia (2,4,6,8,16), default 2`;

    if (!/image\/(jpe?g|png)/.test(mime))
        throw `Mime ${mime} tidak support`;
    if (!/(2|4|6|8|16)/.test(args[0].toString()))
        throw "Ukuran yang tersedia hanya 2,4,6,8,16 dan harus berupa angka!";
    m.reply("Proses Kak...\nGambar sedang di download");

    let img = await q.download?.();

    m.reply("gambar selesai di download\nMulai menjernihkan");

    let error;

        try {
            const This = await upscale(img);
            await conn.sendMedia(m.from, This, m)
        } catch (e) {
            m.reply(e)
        }
        
};

handler.help = ['remini', 'hd2', 'jernih2'];
handler.tags = ['ai'];
handler.command = /^(remini|hd2|jernih2)$/i;
handler.register = false;
handler.limit = 1;
handler.disable = false;

export default handler;

async function upscale(buffer, size = 2, anime = false) {
	try {
		return await new Promise((resolve, reject) => {
			if (!buffer) return reject("undefined buffer input!");
			if (!Buffer.isBuffer(buffer)) return reject("invalid buffer input");
			if (!/(2|4|6|8|16)/.test(size.toString())) return reject("invalid upscale size!");
			
			Jimp.read(Buffer.from(buffer))
				.then(image => {
					const { width, height } = image.bitmap;
					let newWidth = width * size;
					let newHeight = height * size;
					const form = new FormData();
					form.append("name", "upscale-" + Date.now());
					form.append("imageName", "upscale-" + Date.now());
					form.append("desiredHeight", newHeight.toString());
					form.append("desiredWidth", newWidth.toString());
					form.append("outputFormat", "png");
					form.append("compressionLevel", "none");
					form.append("anime", anime.toString());
					form.append("image_file", buffer, {
						filename: "upscale-" + Date.now() + ".png",
						contentType: 'image/png',
					});
					axios.post("https://api.upscalepics.com/upscale-to-size", form, {
						headers: {
							...form.getHeaders(),
							origin: "https://upscalepics.com",
							referer: "https://upscalepics.com"
						}
					})
					.then(res => {
						const data = res.data;
						if (data.error) return reject("something error from upscaler api!");
						resolve(data.bgRemoved);
					})
					.catch(reject);
				})
				.catch(reject);
		});
	} catch (e) {
		return { status: false, message: e };
	}
}
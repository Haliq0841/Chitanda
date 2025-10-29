import { Jimp } from "jimp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { Canvas, GlobalFonts, createCanvas } from "@napi-rs/canvas";

const __dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../')

let handler = async (m, {
    conn,
    usedPrefix,
    command,
    args,
    text,
    db,
    isOwner,
    isPrems
}) => {
    if (!args[0]) throw `Example:\n${usedPrefix + command} Hello World`;
    switch (command.toLowerCase()) {
        case 'brat':
        case 'bratext':
        case 'brattext':
            {
                const buffer = await BratGenerator(text);
                let encmedia = await conn.sendImageAsSticker(m.from, buffer, m, { packname: m.pushName, author: db.data.setting.packname })
                await fs.unlinkSync(encmedia)
            }
            break; 
        case 'bratvideo':
        case 'bratvid':
            {
                const output = await makeBratVideo(text)
                let buffer = await fs.readFileSync(output)
                let encmedia = await conn.sendVideoAsSticker(m.from, buffer, m, { packname: m.pushName, author: db.data.setting.packname })
                await fs.unlinkSync(encmedia)
                fs.existsSync(output) && fs.unlinkSync(output)
            }
            break;
  }
}

handler.help = ['brat', 'bratvideo'].map(v => v + ' <teks>');
handler.tags = ['maker'];
handler.command = /^(brat|brat?text|bratvid(eo)?)$/i;

export default handler;

async function BratGenerator(teks) {
  const width = 1024;
  const height = 1024;
  const margin = 60;
  const wordSpacing = 60;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background putih
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Daftarkan font
  const emojiRegex = /([\p{Emoji}])/gu;
  const fontPath = emojiRegex.test(teks) ? path.join(__dirname, './lib/SEGUIEMJ.ttf') : path.join(__dirname, './lib/arialnarrow.ttf');
  GlobalFonts.registerFromPath(fontPath, 'Narrow');

  // Siapkan style teks
  let fontSize = 300;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'black';

  const words = teks.trim().split(/\s+/);
  let lines = [];

  const rebuildLines = () => {
    lines = [];
    let currentLine = '';
    for (let word of words) {
      let testLine = currentLine ? `${currentLine} ${word}` : word;
      let testWidth =
        ctx.measureText(testLine).width + (testLine.split(' ').length - 1) * wordSpacing;
      if (testWidth < width - 2 * margin) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  };

  // Ubah ukuran font agar muat dalam canvas
  let fits = false;
  while (!fits && fontSize > 10) {
    ctx.font = `${fontSize}px Narrow`;
    rebuildLines();
    const totalHeight = lines.length * fontSize * 1.3;

    const lineWidths = lines.map(line =>
      line.split(' ').reduce((acc, word) => acc + ctx.measureText(word).width, 0) +
      (line.split(' ').length - 1) * wordSpacing
    );
    const maxLineWidth = Math.max(...lineWidths);

    if (totalHeight <= height - 2 * margin && maxLineWidth <= width - 2 * margin) {
      fits = true;
    } else {
      fontSize -= 2;
    }
  }

  // Gambar teks di tengah canvas
  const totalTextHeight = lines.length * fontSize * 1.3;
  let y = (height - totalTextHeight) / 2;

  for (let line of lines) {
    const wordsInLine = line.split(' ');
    const lineWidth =
      wordsInLine.reduce((acc, word) => acc + ctx.measureText(word).width, 0) +
      (wordsInLine.length - 1) * wordSpacing;
    let x = (width - lineWidth) / 2;

    for (let word of wordsInLine) {
      const wordWidth = ctx.measureText(word).width;
      ctx.fillText(word, x + wordWidth / 2, y);
      x += wordWidth + wordSpacing;
    }
    y += fontSize * 1.3;
  }

  // Simpan ke buffer dan blur
  const buffer = await canvas.toBuffer('image/png');
  const image = await Jimp.read(buffer);
  image.blur(2);
  const finalBuffer = await image.getBuffer("image/png");

  return finalBuffer
}

function colorize(ctx, width, colors) {
  if (Array.isArray(colors)) {
    let gradient = ctx.createLinearGradient(0, 0, width, 0);
    let step = 1 / (colors.length - 1);
    colors.forEach((color, index) => {
      gradient.addColorStop(index * step, color);
    });
    return gradient;
  } else {
    return colors;
  }
}

async function renderTextToBuffer(text, options = {}) {
  const width = 512;
  const height = 512;
  const margin = 20;
  const wordSpacing = 25;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colorize(ctx, width, options.background) || "white";
  ctx.fillRect(0, 0, width, height);
  let fontSize = 150;
  const lineHeightMultiplier = 1.3;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `${fontSize}px Sans-serif`;
  const words = text.split(" ");
  const datas = words.map(() => options.color || "black");
  let lines = [];
  function rebuildLines() {
    lines = [];
    let currentLine = "";
    for (let word of words) {
      if (ctx.measureText(word).width > width - 2 * margin) {
        fontSize -= 2;
        ctx.font = `${fontSize}px Sans-serif`;
        return rebuildLines();
      }
      let testLine = currentLine ? `${currentLine} ${word}` : word;
      let lineWidth =
        ctx.measureText(testLine).width +
        (currentLine.split(" ").length - 1) * wordSpacing;
      if (lineWidth < width - 2 * margin) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  rebuildLines();
  while (lines.length * fontSize * lineHeightMultiplier > height - 2 * margin) {
    fontSize -= 2;
    ctx.font = `${fontSize}px Sans-serif`;
    rebuildLines();
  }
  const lineHeight = fontSize * lineHeightMultiplier;
  let y = margin;
  let i = 0;
  for (let line of lines) {
    const wordsInLine = line.split(" ");
    let x = margin;
    const space =
      (width - 2 * margin - ctx.measureText(wordsInLine.join("")).width) /
      (wordsInLine.length - 1);
    for (let word of wordsInLine) {
      ctx.fillStyle = colorize(ctx, ctx.measureText(word).width, datas[i]);
      ctx.fillText(word, x, y);
      x += ctx.measureText(word).width + space;
      i++;
    }
    y += lineHeight;
  }
  const buffer = canvas.toBuffer("image/png");
  if (options.blur) {
    const img = await Jimp.read(buffer);
    img.blur(options.blur);
    return await img.getBuffer("image/png");
  }
  return buffer;
}

async function makeBratVideo(text, {
  output = "./brat_video.mp4",
  background = "white",
  color = "black",
  blur = 1,
  speed = "normal"
} = {}) {
  const words = text.split(" ");
  const tmpDir = path.join(process.cwd(), "tmp_brat");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const framePaths = [];
  for (let i = 0; i < words.length; i++) {
    const partial = words.slice(0, i + 1).join(" ");
    const buffer = await renderTextToBuffer(partial, { background, color, blur });
    const framePath = path.join(tmpDir, `frame_${i}.png`);
    fs.writeFileSync(framePath, buffer);
    framePaths.push(framePath);
  }
  const fileListPath = path.join(tmpDir, "filelist.txt");
  const duration = { fast: 0.4, normal: 1, slow: 1.6 }[speed] || 1;
  let fileList = "";
  framePaths.forEach(f => {
    fileList += `file '${f}'\n`;
    fileList += `duration ${duration}\n`;
  });
  fileList += `file '${framePaths[framePaths.length - 1]}'\n`;
  fileList += `duration 2\n`;
  fs.writeFileSync(fileListPath, fileList);
  try {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${fileListPath}" -vf "fps=30,format=yuv420p" "${output}"`);
  } catch (e) {
    throw "ffmpeg error: " + e.message;
  }
  framePaths.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
  fs.existsSync(fileListPath) && fs.unlinkSync(fileListPath);
  fs.existsSync(tmpDir) && fs.rmdirSync(tmpDir);
  return output;
}
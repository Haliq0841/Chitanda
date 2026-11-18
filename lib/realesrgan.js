import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import unzipper from 'unzipper';
import ffmpeg from 'fluent-ffmpeg';
import { getBinaryPath } from '../Binary/init.js';

const execFileAsync = promisify(execFile);
export const modelDir = path.join(process.cwd(), 'models', 'realesrgan');
const binaryName = process.platform === 'win32'
    ? 'realesrgan-ncnn-vulkan.exe'
    : 'realesrgan-ncnn-vulkan';

function findBinary(directory) {
    if (!fs.existsSync(directory)) return null;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isFile() && entry.name === binaryName) return entryPath;
        if (entry.isDirectory()) {
            const result = findBinary(entryPath);
            if (result) return result;
        }
    }
    return null;
}

function getInstalledTool() {
    const binary = findBinary(modelDir);
    if (!binary) return null;
    const root = path.dirname(binary);
    const models = path.join(root, 'models');
    return {
        binary,
        root,
        models: fs.existsSync(models) ? models : root
    };
}

function reportProgress(progress, value) {
    progress?.(value, 100);
}

function getModel(scale, anime) {
    if (anime) return 'realesrgan-x4plus-anime';
    return scale === 4 ? 'realesrgan-x4plus' : 'realesr-animevideov3';
}

function getModelFile(model, scale) {
    const suffix = model === 'realesr-animevideov3' ? `-x${scale}` : '';
    return `${model}${suffix}`;
}

async function runUpscale(binary, root, models, source, dest, options) {
    const args = [
        '-i', source,
        '-o', dest,
        '-n', options.model,
        '-s', String(options.scale),
        '-m', models,
        '-f', 'png',
        '-t', String(options.tileSize || 0),
        '-j', '1:1:1'
    ];
    await execFileAsync(binary, args, {
        cwd: root,
        windowsHide: true,
        timeout: options.timeout || 0
    });
}

export async function upscaleImage(source, dest, options = {}, progress) {
    const tool = getInstalledTool();
    if (!tool) {
        throw new Error('Model Real-ESRGAN belum terpasang. Jalankan: npm run realesrgan:install-model');
    }

    const scale = Number(options.scale) || 4;
    const anime = Boolean(options.anime);
    const model = getModel(scale, anime);
    const modelFile = getModelFile(model, scale);
    if (!fs.existsSync(path.join(tool.models, `${modelFile}.param`))
        || !fs.existsSync(path.join(tool.models, `${modelFile}.bin`))) {
        throw new Error(`Model Real-ESRGAN "${modelFile}" tidak ditemukan di ${tool.models}. Jalankan ulang npm run realesrgan:install-model.`);
    }

    options.onEngine?.(`Real-ESRGAN ncnn-Vulkan (${model})`);
    reportProgress(progress, 10);
    await runUpscale(tool.binary, tool.root, tool.models, source, dest, {
        ...options,
        scale,
        model
    });
    if (!fs.existsSync(dest)) throw new Error('Binary Real-ESRGAN tidak menghasilkan gambar output.');
    reportProgress(progress, 100);
    return dest;
}

export async function upscaleVideo(source, dest, options = {}, progress) {
    const tool = getInstalledTool();
    if (!tool) {
        throw new Error('Model Real-ESRGAN belum terpasang. Jalankan: npm run realesrgan:install-model');
    }
    ffmpeg.setFfmpegPath(options.ffmpegPath || await getBinaryPath('ffmpeg'));

    const scale = Number(options.scale) || 4;
    const fps = Number(options.fps) || 30;
    const anime = Boolean(options.anime);
    const model = getModel(scale, anime);
    const modelFile = getModelFile(model, scale);
    if (!fs.existsSync(path.join(tool.models, `${modelFile}.param`))
        || !fs.existsSync(path.join(tool.models, `${modelFile}.bin`))) {
        throw new Error(`Model Real-ESRGAN "${modelFile}" tidak ditemukan di ${tool.models}. Jalankan ulang npm run realesrgan:install-model.`);
    }

    const workDir = path.join(path.dirname(dest), `realesrgan-video-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
    const framesDir = path.join(workDir, 'frames');
    const upscaledFramesDir = path.join(workDir, 'upscaled');
    const audioPath = path.join(workDir, 'audio.aac');
    await fs.promises.mkdir(framesDir, { recursive: true });
    await fs.promises.mkdir(upscaledFramesDir, { recursive: true });

    try {
        options.onEngine?.(`Real-ESRGAN ncnn-Vulkan (${model}, video)`);
        reportProgress(progress, 5);

        let extractedAudio = false;
        try {
            await new Promise((resolve, reject) => {
                ffmpeg(source)
                    .noVideo()
                    .audioCodec('aac')
                    .output(audioPath)
                    .on('error', error => {
                        if (/No audio|audio.*not found|not have any audio|stream.*audio|does not contain any stream/i.test(String(error.message || error))) {
                            resolve();
                            return;
                        }
                        reject(error);
                    })
                    .on('end', resolve)
                    .run();
            });
            extractedAudio = fs.existsSync(audioPath);
        } catch (error) {
            throw new Error(`Gagal mengekstrak audio video: ${error.message || error}`);
        }

        await new Promise((resolve, reject) => {
            ffmpeg(source)
                .outputOptions(['-vf', `fps=${fps},format=rgba`])
                .output(path.join(framesDir, 'frame-%06d.png'))
                .on('error', reject)
                .on('end', resolve)
                .run();
        });

        const frameFiles = (await fs.promises.readdir(framesDir))
            .filter(file => /^frame-\d{6}\.png$/i.test(file))
            .sort();
        if (!frameFiles.length) throw new Error('Tidak ada frame video yang berhasil diekstrak untuk Real-ESRGAN.');

        await runUpscale(tool.binary, tool.root, tool.models, framesDir, upscaledFramesDir, {
            ...options,
            scale,
            model,
            timeout: 0
        });
        const upscaledFiles = (await fs.promises.readdir(upscaledFramesDir))
            .filter(file => /^frame-\d{6}\.png$/i.test(file))
            .sort();
        if (upscaledFiles.length !== frameFiles.length) {
            throw new Error(`Real-ESRGAN memproses ${upscaledFiles.length} dari ${frameFiles.length} frame video.`);
        }
        reportProgress(progress, 85);

        const concatListPath = path.join(workDir, 'frames.txt');
        const concatContent = upscaledFiles
            .map(file => `file '${path.join(upscaledFramesDir, file).replace(/'/g, "'\\''")}'`)
            .join('\n');
        await fs.promises.writeFile(concatListPath, concatContent, 'utf8');

        await new Promise((resolve, reject) => {
            const builder = ffmpeg()
                .input(concatListPath)
                .inputOptions(['-safe', '0', '-f', 'concat', '-r', String(fps)]);
            if (extractedAudio) builder.input(audioPath);

            builder
                .outputOptions([
                    '-map', '0:v:0',
                    ...(extractedAudio ? ['-map', '1:a:0'] : []),
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    extractedAudio ? '-c:a' : null,
                    extractedAudio ? 'aac' : null,
                    '-preset', 'veryfast',
                    '-crf', String(options.quality || 18),
                    '-movflags', '+faststart',
                    extractedAudio ? '-shortest' : null
                ].filter(Boolean))
                .on('progress', event => {
                    const percent = Number(event.percent);
                    if (Number.isFinite(percent) && percent >= 0) {
                        reportProgress(progress, 85 + (percent * 0.15));
                    }
                })
                .on('end', resolve)
                .on('error', reject)
                .save(dest);
        });
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    reportProgress(progress, 100);
    return dest;
}

export function chmod777() {
    if (process.platform !== 'win32') {
        const tool = getInstalledTool();
        if (tool) fs.chmodSync(tool.binary, 0o755);
    }
}

export function isModelInstalled() {
    const tool = getInstalledTool();
    return Boolean(tool
        && fs.existsSync(path.join(tool.models, 'realesrgan-x4plus.param'))
        && fs.existsSync(path.join(tool.models, 'realesrgan-x4plus.bin'))
        && fs.existsSync(path.join(tool.models, 'realesrgan-x4plus-anime.param'))
        && fs.existsSync(path.join(tool.models, 'realesrgan-x4plus-anime.bin'))
        && fs.existsSync(path.join(tool.models, 'realesr-animevideov3-x2.param'))
        && fs.existsSync(path.join(tool.models, 'realesr-animevideov3-x2.bin'))
        && fs.existsSync(path.join(tool.models, 'realesr-animevideov3-x3.param'))
        && fs.existsSync(path.join(tool.models, 'realesr-animevideov3-x3.bin'))
        && fs.existsSync(path.join(tool.models, 'realesr-animevideov3-x4.param'))
        && fs.existsSync(path.join(tool.models, 'realesr-animevideov3-x4.bin')));
}

function getPlatformAsset() {
    if (process.platform === 'win32' && process.arch === 'x64') return 'windows';
    if (process.platform === 'linux' && process.arch === 'x64') return 'ubuntu';
    if (process.platform === 'darwin' && process.arch === 'x64') return 'macos';
    throw new Error(`Unduhan Real-ESRGAN tidak didukung pada ${process.platform}/${process.arch}.`);
}

export async function installModel() {
    if (isModelInstalled()) {
        console.log(`Model Real-ESRGAN sudah tersedia di ${modelDir}`);
        return findBinary(modelDir);
    }

    const platform = getPlatformAsset();
    const releaseResponse = await fetch('https://api.github.com/repos/xinntao/Real-ESRGAN/releases/tags/v0.2.5.0', {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Chitanda-Real-ESRGAN-installer'
        }
    });
    if (!releaseResponse.ok) {
        throw new Error(`Gagal mengambil rilis Real-ESRGAN: HTTP ${releaseResponse.status}`);
    }

    const release = await releaseResponse.json();
    const asset = release.assets?.find(item => item.name.toLowerCase() === `realesrgan-ncnn-vulkan-20220424-${platform}.zip`);
    if (!asset?.browser_download_url) {
        throw new Error(`Asset Real-ESRGAN untuk ${process.platform}/${process.arch} tidak ditemukan.`);
    }

    await fs.promises.mkdir(modelDir, { recursive: true });
    const archivePath = path.join(modelDir, '.realesrgan-download.zip');
    console.log(`Mengunduh Real-ESRGAN ${release.tag_name}...`);
    const archiveResponse = await fetch(asset.browser_download_url);
    if (!archiveResponse.ok) throw new Error(`Gagal mengunduh Real-ESRGAN: HTTP ${archiveResponse.status}`);
    await fs.promises.writeFile(archivePath, Buffer.from(await archiveResponse.arrayBuffer()));

    try {
        await fs.createReadStream(archivePath)
            .pipe(unzipper.Extract({ path: modelDir }))
            .promise();
    } finally {
        await fs.promises.rm(archivePath, { force: true });
    }

    chmod777();
    if (!isModelInstalled()) {
        throw new Error(`Arsip selesai diekstrak, tetapi binary atau model Real-ESRGAN tidak ditemukan di ${modelDir}.`);
    }
    console.log(`Real-ESRGAN berhasil dipasang di ${modelDir}`);
    return findBinary(modelDir);
}

export { binaryName };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (process.argv[2] !== 'install-model') {
        console.log('Gunakan: npm run realesrgan:install-model');
    } else {
        installModel().catch(error => {
            console.error(`[Real-ESRGAN] ${error.message}`);
            process.exitCode = 1;
        });
    }
}

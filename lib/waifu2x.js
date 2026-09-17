import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import unzipper from 'unzipper';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const modelDir = path.join(process.cwd(), 'models', 'waifu2x');
const npmWaifu2xDir = path.join(process.cwd(), 'node_modules', 'waifu2x', 'waifu2x');
const binaryName = process.platform === 'win32' ? 'waifu2x-converter-cpp.exe' : 'waifu2x-ncnn-vulkan';

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
    const searchDirs = process.platform === 'win32'
        ? [modelDir, npmWaifu2xDir]
        : [modelDir];
    for (const directory of searchDirs) {
        const binary = findBinary(directory);
        if (binary) {
            return {
                binary,
                root: path.dirname(binary),
                model: path.join(path.dirname(binary), process.platform === 'win32' ? 'models_rgb' : 'models-cunet')
            };
        }
    }
    return null;
}

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

function reportProgress(progress, value) {
    progress?.(value, 100);
}

async function upscaleImageWithSharp(source, dest, options, progress) {
    const metadata = await sharp(source).metadata();
    const scale = Number(options?.scale) || 2;
    const width = Math.max(1, Math.round((metadata.width || 1) * scale));

    reportProgress(progress, 10);
    await sharp(source)
        .resize({ width, kernel: sharp.kernel.lanczos3 })
        .sharpen(options?.noise === -1 ? 0.5 : 1)
        .png()
        .toFile(dest);
    reportProgress(progress, 100);
    return dest;
}

async function upscaleImageWithModel(source, dest, options, progress) {
    const scale = Number(options?.scale) || 2;
    const noise = Number.isInteger(options?.noise) ? options.noise : 1;
    const tool = getInstalledTool();
    const args = process.platform === 'win32'
        ? ['-i', source, '-o', dest, '--model-dir', tool.model]
        : ['-i', source, '-o', dest, '-f', path.extname(source).slice(1)];

    if (process.platform === 'win32') {
        if (options?.noise) args.push('--noise-level', String(noise));
        if (options?.scale) args.push('--scale-ratio', String(scale));
        if (options?.mode) args.push('-m', options.mode);
        if (options?.threads) args.push('-j', String(options.threads));
    } else {
        if (options?.scale) args.push('-s', String(scale));
        if (options?.threads) args.push('-j', `${options.threads}:${options.threads}:${options.threads}`);
        if (options?.waifu2xModel) args.push('-m', options.waifu2xModel);
        if (options?.gpuId !== undefined) args.push('-g', String(options.gpuId));
    }

    try {
        await execFileAsync(tool.binary, args, {
            cwd: tool.root,
            windowsHide: true
        });
        const outputStats = await sharp(dest).stats();
        if (outputStats.channels.every(channel => channel.max <= 1)) {
            await fs.promises.rm(dest, { force: true });
            throw new Error('Binary waifu2x menghasilkan gambar hitam.');
        }
    } finally {
    }
    reportProgress(progress, 100);
    return dest;
}

export async function upscaleImage(source, dest, options = {}, progress) {
    if (!getInstalledTool()) {
        throw new Error('Model waifu2x belum terpasang. Jalankan: npm run waifu2x:install-model');
    }
    options.onEngine?.(process.platform === 'win32' ? 'waifu2x converter' : 'waifu2x NCNN (GPU auto)');
    return upscaleImageWithModel(source, dest, options, progress);
}

export async function upscaleVideo(source, dest, options = {}, progress) {
    const scale = Number(options.scale) || 2;
    const fps = Number(options.fps) || 30;
    const tool = getInstalledTool();
    reportProgress(progress, 10);

    if (tool) {
        const workDir = path.join(path.dirname(dest), `waifu2x-video-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
        const framesDir = path.join(workDir, 'frames');
        const audioPath = path.join(workDir, 'audio.aac');
        await fs.promises.mkdir(framesDir, { recursive: true });

        try {
            options.onEngine?.(process.platform === 'win32' ? 'waifu2x converter (video)' : 'waifu2x NCNN (GPU auto)');
            let extractedAudio = false;
            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(source)
                        .noVideo()
                        .audioCodec('aac')
                        .output(audioPath)
                        .on('error', error => {
                            if (/No audio|audio.*not found|not have any audio|stream.*audio/i.test(String(error.message || error))) {
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
                extractedAudio = false;
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

            if (!frameFiles.length) {
                throw new Error('Tidak ada frame video yang berhasil diekstrak untuk waifu2x.');
            }

            const upscaledFrames = [];
            for (let index = 0; index < frameFiles.length; index++) {
                const frameName = frameFiles[index];
                const inputFrame = path.join(framesDir, frameName);
                const outputFrame = path.join(framesDir, `upscaled-${frameName}`);
                const args = process.platform === 'win32'
                    ? ['-i', inputFrame, '-o', outputFrame, '--model-dir', tool.model, '--scale-ratio', String(scale), '--noise-level', String(Number.isInteger(options.noise) ? options.noise : 1), '-m', options.mode || 'noise-scale', '-j', String(options.threads || 1)]
                    : ['-i', inputFrame, '-o', outputFrame, '-s', String(scale), '-j', `${options.threads || 1}:${options.threads || 1}:${options.threads || 1}`];

                await execFileAsync(tool.binary, args, {
                    cwd: tool.root,
                    windowsHide: true
                });

                upscaledFrames.push(outputFrame);
                const percent = ((index + 1) / frameFiles.length) * 85;
                reportProgress(progress, Math.min(95, 10 + percent));
            }

            const sortedUpscaledFrames = upscaledFrames.sort((a, b) => {
                const aMatch = path.basename(a).match(/(\d{6})/);
                const bMatch = path.basename(b).match(/(\d{6})/);
                const aIndex = Number(aMatch ? aMatch[1] : 0);
                const bIndex = Number(bMatch ? bMatch[1] : 0);
                return aIndex - bIndex;
            });

            const concatListPath = path.join(workDir, 'input.txt');
            const concatContent = sortedUpscaledFrames
                .map(file => `file '${file.replace(/'/g, "'\\''")}'`)
                .join('\n');
            await fs.promises.writeFile(concatListPath, concatContent, 'utf8');

            await new Promise((resolve, reject) => {
                const builder = ffmpeg()
                    .input(concatListPath)
                    .inputOptions(['-safe', '0', '-f', 'concat', '-r', String(fps)]);

                if (extractedAudio) {
                    builder.input(audioPath);
                }

                builder
                    .outputOptions([
                        extractedAudio ? '-map' : '-map', extractedAudio ? '0:v:0' : '0:v:0',
                        extractedAudio ? '-map' : null,
                        extractedAudio ? '1:a:0' : null,
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
                            reportProgress(progress, 95 + (percent * 0.05));
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

    await new Promise((resolve, reject) => {
        ffmpeg(source)
            .videoFilters(`scale=iw*${scale}:ih*${scale}:flags=lanczos`)
            .videoCodec('libx264')
            .outputOptions(['-preset', 'veryfast', '-crf', String(options.quality || 23), '-movflags', '+faststart', '-pix_fmt', 'yuv420p'])
            .on('progress', event => reportProgress(progress, event.percent || 0))
            .on('end', resolve)
            .on('error', reject)
            .save(dest);
    });

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
    return Boolean(getInstalledTool());
}

function getReleaseAssetName() {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'macos';
    return 'linux';
}

export async function installModel() {
    if (isModelInstalled()) {
        console.log(`Model waifu2x sudah tersedia di ${modelDir}`);
        return findBinary(modelDir);
    }

    if (process.platform === 'win32') {
        const npmCommand = process.env.ComSpec ? 'npm.cmd' : 'npm';
        console.log('Mengunduh binary Windows dari package waifu2x npm...');
        await execFileAsync(npmCommand, ['install', '--no-save', 'waifu2x@1.6.5'], {
            cwd: process.cwd(),
            windowsHide: true
        });
        const tool = getInstalledTool();
        if (!tool) {
            throw new Error('Binary waifu2x-converter-cpp Windows tidak ditemukan setelah instalasi package npm.');
        }
        console.log(`Binary waifu2x berhasil dipasang di ${tool.binary}`);
        return tool.binary;
    }

    const releaseResponse = await fetch('https://api.github.com/repos/nihui/waifu2x-ncnn-vulkan/releases/latest', {
        headers: { 'User-Agent': 'Chitanda-waifu2x-installer' }
    });
    if (!releaseResponse.ok) {
        throw new Error(`Gagal mengambil release waifu2x: HTTP ${releaseResponse.status}`);
    }

    const release = await releaseResponse.json();
    const marker = getReleaseAssetName();
    const asset = release.assets?.find(item => item.name.endsWith('.zip') && item.name.toLowerCase().includes(marker));
    if (!asset) {
        throw new Error(`Asset waifu2x untuk ${process.platform} tidak ditemukan.`);
    }

    await fs.promises.mkdir(modelDir, { recursive: true });
    const archivePath = path.join(modelDir, '.waifu2x-download.zip');
    console.log(`Mengunduh model waifu2x ${release.tag_name}...`);
    const archiveResponse = await fetch(asset.browser_download_url);
    if (!archiveResponse.ok) {
        throw new Error(`Gagal mengunduh model waifu2x: HTTP ${archiveResponse.status}`);
    }
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
        throw new Error(`Model selesai diunduh, tetapi binary ${binaryName} tidak ditemukan.`);
    }
    console.log(`Model waifu2x berhasil dipasang di ${modelDir}`);
    return findBinary(modelDir);
}

export { modelDir, binaryName };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (process.argv[2] !== 'install-model') {
        console.log('Gunakan: npm run waifu2x:install-model');
    } else {
        installModel().catch(error => {
            console.error(`[waifu2x] ${error.message}`);
            process.exitCode = 1;
        });
    }
}

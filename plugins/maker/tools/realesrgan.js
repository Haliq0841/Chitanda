import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getBinaryPath } from '../../../Binary/init.js';
import * as realesrgan from '../../../lib/realesrgan.js';

const execFileAsync = promisify(execFile);
const tempDir = path.join(process.cwd(), 'temp');

function getMediaInfo(message) {
    const source = message?.msg || message || {};
    return {
        mime: String(source.mimetype || message?.mediaType || '').toLowerCase(),
        fileName: source.fileName || source.filename || ''
    };
}

function getOptions(args = [], ffmpegPath = null) {
    const scaleArg = args.find(value => /^(2|3|4)$/.test(value));
    const invalidScale = args.find(value => /^\d+$/.test(value) && !/^(2|3|4)$/.test(value));
    if (invalidScale) throw 'Skala Real-ESRGAN yang tersedia hanya 2, 3, atau 4.';
    const scale = Number(scaleArg || 4);
    const anime = args.some(value => /^anime$/i.test(value));
    if (anime && scale !== 4) throw 'Model anime Real-ESRGAN hanya mendukung skala 4x.';
    return {
        scale,
        anime,
        tileSize: 0,
        threads: 1,
        ...(ffmpegPath ? { ffmpegPath } : {})
    };
}

function getImageExtension(mime) {
    if (mime === 'image/png') return '.png';
    if (mime === 'image/webp') return '.webp';
    return '.jpg';
}

async function downloadMedia(message, conn) {
    return await message.download?.()
        || await conn.downloadMediaMessage?.(message)
        || await conn.downloadMediaMessage?.(message, 'realesrgan');
}

function getDurationSeconds(source = {}) {
    const candidates = [
        source?.seconds,
        source?.duration,
        source?.mediaDuration,
        source?.videoDuration,
        source?.msg?.seconds,
        source?.msg?.duration,
        source?.msg?.mediaDuration,
        source?.message?.videoMessage?.seconds,
        source?.message?.videoMessage?.duration,
        source?.message?.videoMessage?.mediaDuration,
        source?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage?.seconds,
        source?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage?.duration,
    ];

    for (const value of candidates) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
}

async function getVideoDurationFromFile(filePath, ffmpegPath) {
    try {
        const { stderr } = await execFileAsync(ffmpegPath, ['-i', filePath, '-f', 'null', '-'], {
            windowsHide: true,
            timeout: 30000,
        });
        const match = String(stderr || '').match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
        if (!match) return null;
        return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    } catch (error) {
        const text = String(error?.stderr || error?.message || '');
        const match = text.match(/Duration:\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
        if (!match) return null;
        return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }
}

function createProgressReporter(status, label) {
    let lastStep = -1;
    let editQueue = Promise.resolve();

    const report = (current, total) => {
        const value = Number(current);
        const max = Number(total);
        const percent = Number.isFinite(max) && max > 0
            ? (value / max) * 100
            : Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
        if (percent === null) return;

        const step = Math.min(20, Math.floor(Math.max(0, percent) / 5));
        if (step <= lastStep) return;
        lastStep = step;
        const bar = `${'#'.repeat(step)}${'-'.repeat(20 - step)}`;
        editQueue = editQueue
            .then(() => status.edit(`${label}\n\`\`\`\nprogress [${bar}] ${step * 5}%\n\`\`\``))
            .catch(() => {});
    };

    return { report, flush: () => editQueue };
}

const queues = {
    image: { jobs: [], running: false },
    video: { jobs: [], running: false }
};
let resourceTail = Promise.resolve();

async function runWithResource(task) {
    const previous = resourceTail;
    let release;
    resourceTail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        return await task();
    } finally {
        release();
    }
}

function updateQueueMessages(queue) {
    queue.jobs.forEach((job, index) => {
        if (!job.status) return;
        job.status.edit(`Menunggu antrean Real-ESRGAN (tersisa ${index + 1} di depan).\nTunggu ya, proses akan dimulai segera setelah antrean selesai.`).catch(() => {});
    });
}

function processQueue(queue) {
    if (queue.running || !queue.jobs.length) return;
    const job = queue.jobs.shift();
    queue.running = true;
    updateQueueMessages(queue);

    Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
            queue.running = false;
            processQueue(queue);
        });
}

function enqueueJob(type, task) {
    const queue = queues[type];
    let resolveJob;
    let rejectJob;
    const run = new Promise((resolve, reject) => {
        resolveJob = resolve;
        rejectJob = reject;
    });
    const position = (queue.running ? 1 : 0) + queue.jobs.length + 1;
    const job = { task, resolve: resolveJob, reject: rejectJob, status: null };
    queue.jobs.push(job);
    processQueue(queue);
    return {
        position,
        run,
        setStatus(status) {
            job.status = status;
            updateQueueMessages(queue);
        }
    };
}

const handler = async (m, { conn, args, usedPrefix, command, db }) => {
    const quoted = m.quoted ? m.quoted : m;
    const { mime, fileName } = getMediaInfo(quoted);

    if (!mime) {
        throw `Kirim atau reply gambar/video dengan perintah ${usedPrefix + command} [2|3|4] [anime].`;
    }
    if (!/^image\/(jpe?g|png|webp)|^video\/(mp4|quicktime|webm|x-matroska)$/.test(mime)) {
        throw `Format ${mime} tidak didukung. Gunakan JPG, PNG, WEBP, MP4, MOV, WEBM, atau MKV.`;
    }

    const options = getOptions(args);
    const mediaLabel = mime.startsWith('video/') ? 'video' : 'gambar';
    const queueType = mime.startsWith('video/') ? 'video' : 'image';
    const status = await m.reply('Memeriksa antrean Real-ESRGAN...');
    let ffmpegPath = null;
    if (mime.startsWith('video/')) {
        ffmpegPath = await getBinaryPath('ffmpeg');
    }
    Object.assign(options, getOptions(args, ffmpegPath));

    let releaseStart;
    const startGate = new Promise(resolve => { releaseStart = resolve; });
    const queued = enqueueJob(queueType, async () => {
        await startGate;
        if (queued.position > 1) await status.edit('Giliran antrean Real-ESRGAN dimulai...');
        const progress = createProgressReporter(status, `Memproses ${mediaLabel} (${options.scale}x)...`);
        const isVideo = mime.startsWith('video/');
        const inputPath = path.join(tempDir, `realesrgan-${crypto.randomUUID()}${isVideo ? '.mp4' : getImageExtension(mime)}`);
        const outputPath = path.join(tempDir, `realesrgan-${crypto.randomUUID()}${isVideo ? '.mp4' : '.png'}`);
        let generatedOutputPath = outputPath;
        let engineUsed = `Real-ESRGAN ncnn-Vulkan (${options.anime ? 'realesrgan-x4plus-anime' : options.scale === 4 ? 'realesrgan-x4plus' : 'realesr-animevideov3'})`;

        try {
            let mediaBuffer = await downloadMedia(quoted, conn);
            if (!mediaBuffer) throw new Error('Gagal mengunduh media dari WhatsApp.');
            await fs.promises.mkdir(tempDir, { recursive: true });
            await fs.promises.writeFile(inputPath, mediaBuffer);
            mediaBuffer = null;

            if (isVideo) {
                const sourceDuration = getDurationSeconds(quoted) ?? await getVideoDurationFromFile(inputPath, options.ffmpegPath);
                m.limit = Number.isFinite(Number(sourceDuration)) && Number(sourceDuration) > 0
                    ? Math.max(1, Math.ceil(Number(sourceDuration)))
                    : 1;
            } else {
                m.limit = 1;
            }

            const currentUserLimit = Number(db?.data?.users?.[m.sender]?.limit ?? 0);
            if (currentUserLimit < Number(m.limit || 0)) {
                throw `Limit kamu tidak cukup untuk video ini. Butuh ${Number(m.limit)} limit, sisa ${currentUserLimit}.`;
            }

            const reportEngine = engine => {
                engineUsed = engine;
                return status.edit(`Memproses ${mediaLabel} (${options.scale}x)...\nEngine: ${engine}`).catch(() => {});
            };
            await status.edit(`Menunggu slot resource Real-ESRGAN...\nEngine: ${engineUsed}`);
            await runWithResource(async () => {
                realesrgan.chmod777();
                generatedOutputPath = isVideo
                    ? await realesrgan.upscaleVideo(inputPath, outputPath, {
                        ...options,
                        quality: 18,
                        onEngine: reportEngine
                    }, progress.report)
                    : await realesrgan.upscaleImage(inputPath, outputPath, {
                        ...options,
                        onEngine: reportEngine
                    }, progress.report);
                if (!generatedOutputPath || !fs.existsSync(generatedOutputPath)) {
                    throw new Error(`Real-ESRGAN tidak menghasilkan file output: ${generatedOutputPath || outputPath}`);
                }
            });

            progress.report(100, 100);
            await progress.flush();
            await status.edit('Selesai diproses, sedang mengirim...');
            const outputBuffer = await fs.promises.readFile(generatedOutputPath);
            const extension = isVideo ? 'mp4' : 'png';
            const outputMime = isVideo ? 'video/mp4' : 'image/png';
            const originalName = path.basename(fileName || `realesrgan.${extension}`, path.extname(fileName || ''))
                .replace(/[\\/:*?"<>|]/g, '_');

            await conn.sendMedia(m.chat || m.from, outputBuffer, m, {
                mimetype: outputMime,
                fileName: `${originalName}-realesrgan.${extension}`,
                caption: `Real-ESRGAN ${options.scale}x berhasil diproses.\nEngine: ${engineUsed}`
            });
        } catch (error) {
            await status.edit(`Gagal memproses media: ${error?.message || error}`);
            throw error;
        } finally {
            await fs.promises.rm(inputPath, { force: true }).catch(() => {});
            await fs.promises.rm(outputPath, { force: true }).catch(() => {});
            if (generatedOutputPath !== outputPath) {
                await fs.promises.rm(generatedOutputPath, { force: true }).catch(() => {});
            }
        }
    });

    queued.setStatus(status);
    try {
        await status.edit(queued.position > 1
            ? `Masuk antrean Real-ESRGAN (urutan ${queued.position - 1}).\nTunggu ya, proses akan dimulai segera setelah antrean selesai.`
            : `Sedang meningkatkan kualitas ${mediaLabel} (${options.scale}x)...`);
    } finally {
        releaseStart();
    }
    return queued.run;
};

handler.help = ['realesrgan', 'hd', 'hdvideo'];
handler.tags = ['maker', 'tools'];
handler.command = /^(realesrgan|real-esrgan|esrgan|hd|hdvid(eo)?|upscale)$/i;
handler.limit = 1;

export default handler;

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import * as waifu2x from '../../../lib/waifu2x.js';

const execFileAsync = promisify(execFile);

const tempDir = path.join(process.cwd(), 'temp');
function prepareWaifu2xBinaries() {
    if (process.platform !== 'win32') {
        waifu2x.chmod777?.();
    }
}

function getMediaInfo(message) {
    const source = message?.msg || message || {};
    return {
        mime: String(source.mimetype || message?.mediaType || '').toLowerCase(),
        fileName: source.fileName || source.filename || ''
    };
}

function getOptions(args = []) {
    const scale = Number(args.find(value => /^(2|4)$/.test(value)) || 2);
    const noise = Number(args.find(value => /^-?[0-3]$/.test(value)) || 1);
    return {
        scale,
        noise,
        mode: noise === -1 ? 'scale' : 'noise-scale',
        threads: 1,
        parallelFrames: 1,
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
        || await conn.downloadMediaMessage?.(message, 'hd');
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

async function getVideoDurationFromFile(filePath) {
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

        const step = Math.min(5, Math.floor(Math.max(0, percent) / 5));
        if (step <= lastStep) return;
        lastStep = step;
        const completed = step;
        const bar = `${'#'.repeat(completed)}${'-'.repeat(20 - completed)}`;
        editQueue = editQueue
            .then(() => status.edit(`${label}\n\`\`\`\nprogress [${bar}] ${step * 5}%\n\`\`\``))
            .catch(() => {});
    };

    return {
        report,
        flush: () => editQueue
    };
}

const hdQueues = {
    image: { jobs: [], running: false },
    video: { jobs: [], running: false }
};
let hdResourceTail = Promise.resolve();

async function runWithHdResource(task) {
    const previous = hdResourceTail;
    let release;
    hdResourceTail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
        return await task();
    } finally {
        release();
    }
}

function updateHdQueueMessages(queue) {
    queue.jobs.forEach((job, index) => {
        if (!job.status) return;
        job.status.edit(`Menunggu antrean HD (tersisa ${index + 1} di depan).\nTunggu ya, proses akan dimulai segera setelah antrean selesai.`).catch(() => {});
    });
}

function processHdQueue(queue) {
    if (queue.running || !queue.jobs.length) return;

    const job = queue.jobs.shift();
    queue.running = true;
    updateHdQueueMessages(queue);

    Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
            queue.running = false;
            processHdQueue(queue);
        });
}

function enqueueHdJob(type, task) {
    const queue = hdQueues[type];
    let resolveJob;
    let rejectJob;
    const run = new Promise((resolve, reject) => {
        resolveJob = resolve;
        rejectJob = reject;
    });
    const position = (queue.running ? 1 : 0) + queue.jobs.length + 1;
    const job = { task, resolve: resolveJob, reject: rejectJob, status: null };
    queue.jobs.push(job);
    processHdQueue(queue);
    return {
        position,
        run,
        setStatus(status) {
            job.status = status;
            updateHdQueueMessages(queue);
        }
    };
}

const handler = async (m, { conn, args, usedPrefix, command, db }) => {
    const quoted = m.quoted ? m.quoted : m;
    const { mime, fileName } = getMediaInfo(quoted);

    if (!mime) {
        throw `Kirim atau reply gambar/video dengan perintah ${usedPrefix + command} [2|4] [noise].`;
    }
    if (!/^image\/(jpe?g|png|webp)|^video\/(mp4|quicktime|webm|x-matroska)$/.test(mime)) {
        throw `Format ${mime} tidak didukung. Gunakan JPG, PNG, WEBP, MP4, MOV, WEBM, atau MKV.`;
    }
    if (!ffmpegPath && mime.startsWith('video/')) {
        throw 'FFmpeg tidak tersedia untuk memproses video.';
    }

    const options = getOptions(args);
    const mediaLabel = mime.startsWith('video/') ? 'video' : 'gambar';
    const queueType = mime.startsWith('video/') ? 'video' : 'image';
    const status = await m.reply('Memeriksa antrean HD...');
    let releaseStart;
    const startGate = new Promise(resolve => { releaseStart = resolve; });
    const queued = enqueueHdJob(queueType, async () => {
        await startGate;
        if (queued.position > 1) {
            await status.edit('Giliran antrean HD dimulai...');
        }
        const progress = createProgressReporter(status, `Memproses ${mediaLabel} (${options.scale}x)...`);
        const inputPath = path.join(tempDir, `hd-${crypto.randomUUID()}${mime.startsWith('video/') ? '.mp4' : getImageExtension(mime)}`);
        const outputPath = path.join(tempDir, `hd-${crypto.randomUUID()}${mime.startsWith('video/') ? '.mp4' : '.png'}`);
        let generatedOutputPath = outputPath;
        let engineUsed = mime.startsWith('video/')
            ? 'waifu2x (video)'
            : process.platform === 'win32' ? 'waifu2x converter' : 'waifu2x NCNN (GPU auto)';

        try {
            let mediaBuffer = await downloadMedia(quoted, conn);
            if (!mediaBuffer) throw new Error('Gagal mengunduh media dari WhatsApp.');
            await fs.promises.mkdir(tempDir, { recursive: true });
            await fs.promises.writeFile(inputPath, mediaBuffer);
            mediaBuffer = null;

            if (mime.startsWith('video/')) {
                const sourceDuration = getDurationSeconds(quoted) ?? await getVideoDurationFromFile(inputPath);
                const durationLimit = Number.isFinite(Number(sourceDuration)) && Number(sourceDuration) > 0
                    ? Math.max(1, Math.ceil(Number(sourceDuration)))
                    : 1;
                m.limit = durationLimit;
            } else {
                m.limit = 1;
            }

            const currentUserLimit = Number(db?.data?.users?.[m.sender]?.limit ?? 0);
            if (currentUserLimit < Number(m.limit || 0)) {
                throw `Limit kamu tidak cukup untuk video ini. Butuh ${Number(m.limit)} limit, sisa ${currentUserLimit}.`;
            }

            const engineLabel = mime.startsWith('video/')
                ? 'waifu2x converter (video)'
                : process.platform === 'win32' ? 'waifu2x converter' : 'waifu2x NCNN (GPU auto)';
            engineUsed = engineLabel;
            const reportEngine = engine => {
                engineUsed = engine;
                return status.edit(`Memproses ${mediaLabel} (${options.scale}x)...\nEngine: ${engine}`).catch(() => {});
            };
            await status.edit(`Menunggu slot resource HD...\nEngine: ${engineLabel}`);
            await runWithHdResource(async () => {
                prepareWaifu2xBinaries();
                if (mime.startsWith('video/')) {
                    generatedOutputPath = await waifu2x.upscaleVideo(inputPath, outputPath, {
                        ...options,
                        quality: 14,
                        pngFrames: true,
                        speed: 1,
                        onEngine: reportEngine
                    }, progress.report);
                    if (!generatedOutputPath || !fs.existsSync(generatedOutputPath)) {
                        throw new Error(`Waifu2x tidak menghasilkan file output: ${generatedOutputPath || outputPath}`);
                    }
                } else {
                    generatedOutputPath = await waifu2x.upscaleImage(inputPath, outputPath, {
                        ...options,
                        onEngine: reportEngine
                    }, progress.report);
                    if (!generatedOutputPath || !fs.existsSync(generatedOutputPath)) {
                        throw new Error(`Waifu2x tidak menghasilkan file output: ${generatedOutputPath || outputPath}`);
                    }
                }
            });

            progress.report(100, 100);
            await progress.flush();
            await status.edit('Selesai diproses, sedang mengirim...');
            const outputBuffer = await fs.promises.readFile(generatedOutputPath);
            const outputMime = mime.startsWith('video/') ? 'video/mp4' : 'image/png';
            const extension = mime.startsWith('video/') ? 'mp4' : 'png';
            const originalName = path.basename(fileName || `hd.${extension}`, path.extname(fileName || ''))
                .replace(/[\\/:*?"<>|]/g, '_');

            await conn.sendMedia(m.chat || m.from, outputBuffer, m, {
                mimetype: outputMime,
                fileName: `${originalName}-hd.${extension}`,
                caption: `HD ${options.scale}x berhasil diproses.\nEngine: ${engineUsed}`
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
            ? `Masuk antrean HD (urutan ${queued.position - 1}).\nTunggu ya, proses akan dimulai segera setelah antrean selesai.`
            : `Sedang meningkatkan kualitas ${mediaLabel} (${options.scale}x)...`);
    } finally {
        releaseStart();
    }

    return queued.run;
};

handler.help = ['hd [2|4] [noise]', 'hdvideo [2|4] [noise]'];
handler.tags = ['maker', 'tools'];
handler.command = /^(hd|waifu2x|upscale|hdvideo|hdvid)$/i;
handler.limit = 1;

export default handler;

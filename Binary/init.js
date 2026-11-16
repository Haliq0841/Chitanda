import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import unzipper from 'unzipper';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const binaryDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(binaryDir);
const binarySpecs = new Map();
const pendingDownloads = new Map();

function platformNames(names) {
    return names.map(name => process.platform === 'win32' ? `${name}.exe` : name);
}

function addSpec(name, spec) {
    binarySpecs.set(name.toLowerCase(), spec);
}

addSpec('ffmpeg', {
    names: platformNames(['ffmpeg']),
    group: 'ffmpeg',
    download: downloadFfmpeg
});
addSpec('ffprobe', {
    names: platformNames(['ffprobe']),
    group: 'ffmpeg',
    packagePaths: [path.join(binaryDir, 'ffmpeg')],
    download: downloadFfmpeg
});
addSpec('ffplay', {
    names: platformNames(['ffplay']),
    group: 'ffmpeg',
    packagePaths: [path.join(binaryDir, 'ffmpeg')],
    download: downloadFfmpeg
});
addSpec('yt-dlp', {
    names: platformNames(['yt-dlp']),
    packagePaths: [path.join(projectDir, 'node_modules', 'ytdlp-nodejs', 'bin')],
    download: downloadYtDlp
});
addSpec('imagemagick', {
    names: process.platform === 'win32' ? ['magick.exe'] : ['magick', 'convert'],
    download: downloadImageMagick
});

function getSpec(name) {
    const key = String(name).toLowerCase();
    const spec = binarySpecs.get(key);
    if (!spec) throw new Error(`Binary "${name}" belum terdaftar.`);
    return spec;
}

function findOnPath(names) {
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const entry of pathEntries) {
        for (const name of names) {
            const candidate = path.join(entry, name);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        }
    }
    return null;
}

function findLocal(names, extraDirs = []) {
    const dirs = [binaryDir, ...extraDirs];
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        }
    }
    return null;
}

export function registerBinary(name, { names, download }) {
    if (!name || !Array.isArray(names) || names.length === 0) {
        throw new TypeError('registerBinary membutuhkan nama dan daftar nama executable.');
    }
    if (typeof download !== 'function') {
        throw new TypeError('registerBinary membutuhkan fungsi download.');
    }
    addSpec(name, { names, download });
}

export async function getBinaryPath(name, { download = true } = {}) {
    const spec = getSpec(name);
    const localDirs = [
        path.join(binaryDir, String(name).toLowerCase()),
        ...(spec.packagePaths || [])
    ];
    const envName = `${String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PATH`;
    const envPath = process.env[envName];
    if (envPath && fs.existsSync(envPath) && fs.statSync(envPath).isFile()) return envPath;

    const existing = findLocal(spec.names, localDirs) || findOnPath(spec.names);
    if (existing) return existing;
    const packagedPath = spec.packagePath?.();
    if (packagedPath || !download) return packagedPath || null;
    if (typeof spec.download !== 'function') {
        throw new Error(`Binary "${name}" tidak ditemukan dan belum memiliki sumber unduhan.`);
    }
    const downloadKey = spec.group || String(name).toLowerCase();
    if (pendingDownloads.has(downloadKey)) {
        await pendingDownloads.get(downloadKey);
        const downloaded = findLocal(spec.names, localDirs) || findOnPath(spec.names);
        if (downloaded) return downloaded;
        throw new Error(`Unduhan selesai, tetapi binary "${name}" tidak ditemukan.`);
    }
    const pending = spec.download(String(name).toLowerCase(), spec.names, binaryDir);
    pendingDownloads.set(downloadKey, pending);
    try {
        const downloaded = await pending;
        return findLocal(spec.names, localDirs) || downloaded;
    } finally {
        pendingDownloads.delete(downloadKey);
    }
}

async function saveDownload(url, targetPath) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
        throw new Error(`Unduhan gagal (${response.status} ${response.statusText}): ${url}`);
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${randomUUID()}.download`;
    try {
        await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
        await fs.promises.rename(tempPath, targetPath);
    } catch (error) {
        await fs.promises.rm(tempPath, { force: true });
        throw error;
    }
}

async function downloadYtDlp(name, names, baseDir) {
    let asset;
    if (process.platform === 'win32') asset = 'yt-dlp.exe';
    else if (process.platform === 'darwin') asset = process.arch === 'arm64' ? 'yt-dlp_macos' : 'yt-dlp_macos';
    else if (process.platform === 'linux') {
        asset = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64'
            : process.arch === 'arm' ? 'yt-dlp_linux_armv7l'
                : 'yt-dlp_linux';
    } else {
        throw new Error(`Unduhan yt-dlp tidak didukung pada platform ${process.platform}.`);
    }

    const targetDir = path.join(baseDir, name);
    const targetPath = path.join(targetDir, names[0]);
    await saveDownload(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, targetPath);
    if (process.platform !== 'win32') await fs.promises.chmod(targetPath, 0o755);
    return targetPath;
}

async function downloadFfmpeg(name, names, baseDir) {
    const targetDir = path.join(baseDir, 'ffmpeg');
    await fs.promises.mkdir(targetDir, { recursive: true });

    if (process.platform === 'win32') {
        const archivePath = path.join(targetDir, '.ffmpeg.zip');
        try {
            await saveDownload('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', archivePath);
            const archive = await unzipper.Open.file(archivePath);
            for (const entry of archive.files) {
                const match = entry.path.match(/(?:^|\/)bin\/(ffmpeg|ffprobe|ffplay)\.exe$/i);
                if (!match) continue;
                const output = path.join(targetDir, `${match[1].toLowerCase()}.exe`);
                await pipeline(entry.stream(), createWriteStream(output));
            }
        } finally {
            await fs.promises.rm(archivePath, { force: true });
        }
    } else if (process.platform === 'linux') {
        if (process.arch !== 'x64' && process.arch !== 'arm64') {
            throw new Error(`Unduhan FFmpeg tidak didukung pada arsitektur Linux ${process.arch}.`);
        }
        const asset = process.arch === 'arm64'
            ? 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz'
            : 'ffmpeg-master-latest-linux64-gpl.tar.xz';
        const archivePath = path.join(targetDir, '.ffmpeg.tar.xz');
        const extractDir = path.join(targetDir, '.extract');
        try {
            await saveDownload(`https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${asset}`, archivePath);
            await fs.promises.mkdir(extractDir, { recursive: true });
            await execFileAsync('tar', ['-xJf', archivePath, '-C', extractDir]);
            for (const binary of ['ffmpeg', 'ffprobe', 'ffplay']) {
                const found = findFile(extractDir, binary);
                if (found) {
                    const output = path.join(targetDir, binary);
                    await fs.promises.copyFile(found, output);
                    await fs.promises.chmod(output, 0o755);
                }
            }
        } finally {
            await fs.promises.rm(archivePath, { force: true });
            await fs.promises.rm(extractDir, { recursive: true, force: true });
        }
    } else if (process.platform === 'darwin') {
        const archivePath = path.join(targetDir, '.ffmpeg.zip');
        try {
            await saveDownload('https://evermeet.cx/ffmpeg/getrelease/zip', archivePath);
            const archive = await unzipper.Open.file(archivePath);
            const entry = archive.files.find(file => file.path === 'ffmpeg');
            if (entry) {
                const output = path.join(targetDir, 'ffmpeg');
                await pipeline(entry.stream(), createWriteStream(output));
                await fs.promises.chmod(output, 0o755);
            }
        } finally {
            await fs.promises.rm(archivePath, { force: true });
        }
    } else {
        throw new Error(`Unduhan FFmpeg tidak didukung pada platform ${process.platform}.`);
    }

    const requested = path.join(targetDir, names[0]);
    if (!fs.existsSync(requested)) {
        throw new Error(`Arsip FFmpeg berhasil diunduh, tetapi executable ${name} tidak ditemukan.`);
    }
    return requested;
}

async function downloadImageMagick(name, names, baseDir) {
    if (process.platform === 'darwin') {
        throw new Error('ImageMagick belum memiliki unduhan portable macOS; pasang ImageMagick lalu tambahkan ke PATH.');
    }
    if (process.platform === 'linux' && process.arch !== 'x64') {
        throw new Error(`Unduhan ImageMagick tidak didukung pada arsitektur Linux ${process.arch}.`);
    }

    const response = await fetch('https://api.github.com/repos/ImageMagick/ImageMagick/releases/latest', {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Chitanda-binary-resolver'
        }
    });
    if (!response.ok) throw new Error(`Tidak dapat memeriksa rilis ImageMagick (${response.status}).`);
    const release = await response.json();
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    const asset = release.assets?.find(item => process.platform === 'win32'
        ? item.name.includes(`portable-Q16-HDRI-${architecture}.7z`)
        : item.name.endsWith('-gcc-x86_64.AppImage'));
    if (!asset?.browser_download_url) {
        throw new Error(`Rilis ImageMagick tidak menyediakan binary untuk ${process.platform}/${process.arch}.`);
    }

    const targetDir = path.join(baseDir, name);
    if (process.platform === 'linux') {
        const targetPath = path.join(targetDir, names[0]);
        await saveDownload(asset.browser_download_url, targetPath);
        await fs.promises.chmod(targetPath, 0o755);
        return targetPath;
    }

    const archivePath = path.join(targetDir, '.imagemagick.7z');
    try {
        await saveDownload(asset.browser_download_url, archivePath);
        await fs.promises.mkdir(targetDir, { recursive: true });
        try {
            await execFileAsync('7z', ['x', '-y', `-o${targetDir}`, archivePath]);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            try {
                await execFileAsync('tar', ['-xf', archivePath, '-C', targetDir]);
            } catch {
                const extractorPath = path.join(targetDir, '.7zr.exe');
                try {
                    await saveDownload('https://github.com/ip7z/7zip/releases/latest/download/7zr.exe', extractorPath);
                    await execFileAsync(extractorPath, ['x', '-y', `-o${targetDir}`, archivePath]);
                } catch (extractorError) {
                    throw new Error('Arsip ImageMagick tidak dapat diekstrak dengan 7-Zip, tar, maupun 7zr.', {
                        cause: extractorError
                    });
                } finally {
                    await fs.promises.rm(extractorPath, { force: true });
                }
            }
        }
    } finally {
        await fs.promises.rm(archivePath, { force: true });
    }
    const installed = names.map(name => findFile(targetDir, name)).find(Boolean);
    if (!installed) throw new Error('Arsip ImageMagick selesai diekstrak, tetapi executable tidak ditemukan.');
    return installed;
}

function findFile(directory, name) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return entryPath;
        if (entry.isDirectory()) {
            const found = findFile(entryPath, name);
            if (found) return found;
        }
    }
    return null;
}

export { binaryDir };
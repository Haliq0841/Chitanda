import { YtDlp } from 'ytdlp-nodejs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import ffmpegPath from 'ffmpeg-static';
import { type } from 'os';

const ytdlp = new YtDlp();
const cookiePath = fileURLToPath(new URL('../../.ytdlp-cookies.txt', import.meta.url));
const tmpDir = path.join(process.cwd(), 'temp');

// coba gunakan proxy jika error
const proxyHost = '127.0.0.1';
const proxyPort = 40000;
//atau ganti dengan proxy yang kamu miliki
/*jika tidak punya kita bisa menggunakan Cloudflare WARP (gratis)
cara install nya:

curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list

sudo apt update
sudo apt install cloudflare-warp -y

warp-cli registration new

warp-cli mode proxy

warp-cli connect

sudo systemctl enable warp-svc
*/

function isProxyAvailable() {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host: proxyHost, port: proxyPort });
        const finish = (available) => {
            socket.destroy();
            resolve(available);
        };

        socket.setTimeout(500);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

async function getYtdlpOptions() {
    const options = {
        ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {})
    };

    if (await isProxyAvailable()) {
        options.proxy = `socks5://${proxyHost}:${proxyPort}`;
    }

    return options;
}

function compressAudioBuffer(inputBuffer) {
    if (!ffmpegPath) throw new Error('FFmpeg tidak tersedia untuk kompresi audio.');

    return new Promise((resolve, reject) => {
        const chunks = [];
        let outputSize = 0;
        const ffmpeg = spawn(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-i', 'pipe:0',
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '16k',
            '-ar', '24000',
            '-ac', '1',
            '-application', 'audio',
            '-f', 'ogg',
            'pipe:1'
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        ffmpeg.stdout.on('data', chunk => {
            outputSize += chunk.length;
            if (outputSize > 6 * 1024 * 1024) {
                ffmpeg.kill();
                reject(new Error('Audio hasil kompresi terlalu besar.'));
                return;
            }
            chunks.push(chunk);
        });

        let errorOutput = '';
        ffmpeg.stderr.on('data', chunk => { errorOutput += chunk.toString(); });
        ffmpeg.once('error', reject);
        ffmpeg.once('close', code => {
            if (code !== 0) {
                reject(new Error(errorOutput.trim() || `FFmpeg gagal (${code})`));
                return;
            }
            const output = Buffer.concat(chunks);
            if (!output.length) {
                reject(new Error('FFmpeg menghasilkan audio kosong.'));
                return;
            }
            resolve(output);
        });

        ffmpeg.stdin.end(inputBuffer);
    });
}

if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const YT_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractVideoId(text) {
    const value = String(text || '').trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
    const match = value.match(YT_REGEX);
    return match ? match[1] : null;
}

function resolveSearchVideoId(result) {
    if (!result || typeof result !== 'object') return null;
    return extractVideoId(result.id) || extractVideoId(result.webpage_url) || extractVideoId(result.url);
}

function getCookies() {
    return fs.existsSync(cookiePath) ? cookiePath : undefined;
}

async function getVideoInfo(videoId) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(String(videoId || ''))) {
        throw 'ID video YouTube tidak valid atau hasil pencarian tidak lengkap.';
    }
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    return await ytdlp.getInfoAsync(url, { ...(await getYtdlpOptions()), cookies: getCookies() });
}

async function searchVideos(query, limit = 10) {
    const result = await ytdlp.exec(`ytsearch${limit}:${query}`, {
        ...(await getYtdlpOptions()),
        cookies: getCookies(),
        flatPlaylist: true,
        dumpSingleJson: true
    });
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.entries)) return result.entries;

    const output = typeof result?.output === 'string' ? result.output : result?.stdout;
    if (typeof output === 'string') {
        try {
            const parsed = JSON.parse(output);
            if (Array.isArray(parsed)) return parsed;
            if (Array.isArray(parsed?.entries)) return parsed.entries;
        } catch {
            // ytdlp-nodejs can return non-JSON diagnostics in output.
        }
    }

    return [];
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatViews(viewCount) {
    if (!viewCount) return '0';
    if (viewCount >= 1e9) return (viewCount / 1e9).toFixed(1) + 'B';
    if (viewCount >= 1e6) return (viewCount / 1e6).toFixed(1) + 'M';
    if (viewCount >= 1e3) return (viewCount / 1e3).toFixed(1) + 'K';
    return viewCount.toString();
}

function parseLyricsTimestamp(match) {
    const minutes = Number(match?.[1]);
    const seconds = Number(match?.[2]);
    const fraction = match?.[3] || '';
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
    const milliseconds = fraction.length === 1 ? Number(fraction) * 100 : fraction.length === 2 ? Number(fraction) * 10 : Number(fraction.slice(0, 3) || 0);
    return minutes * 60 + seconds + milliseconds / 1000;
}

function parseSyncedLyrics(lrc = '') {
    const result = [];
    const timestamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    for (const rawLine of String(lrc).split(/\r?\n/)) {
        const matches = [...rawLine.matchAll(timestamp)];
        const text = rawLine.replace(timestamp, '').trim();
        if (!text) continue;
        for (const match of matches) {
            const time = parseLyricsTimestamp(match);
            if (time !== null) result.push({ time, text });
        }
    }
    return result.sort((a, b) => a.time - b.time);
}

function plainLyricsToSynced(lyrics = '', duration = 0) {
    const lines = String(lyrics).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const interval = lines.length > 1 && Number(duration) > 0 ? Math.max(2, Math.min(8, Number(duration) / lines.length)) : 5;
    return lines.map((text, index) => ({ time: index * interval, text }));
}

async function getLyrics(title, artist, duration = 0) {
    try {
        if (!title || !artist) return [];
        const params = new URLSearchParams({ track_name: title, artist_name: artist });
        if (Number(duration) > 0) params.set('duration', String(Math.round(Number(duration))));
        const response = await fetch(`https://lrclib.net/api/get?${params}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'Chitanda/1.0' }
        });
        if (!response.ok) return [];
        const data = await response.json();
        const synced = parseSyncedLyrics(data?.syncedLyrics || '');
        return synced.length ? synced : plainLyricsToSynced(data?.plainLyrics || '', duration);
    } catch {
        return [];
    }
}

function escapeHtml(value = '') {
        return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
}

function createLegacyMusicPlayer({ title, artist, duration }) {
        return `
<style>
    * { box-sizing: border-box; }
    body { margin: 0; background: transparent; color: #fff; font-family: sans-serif; }
    .player { width: 100%; max-width: 360px; margin: auto; padding: 18px; border-radius: 16px; background: linear-gradient(145deg, #29131c, #100b12); box-shadow: 0 16px 36px rgba(0,0,0,.45); }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 700; }
    .artist { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b9aeb5; font-size: 13px; }
    .bar { width: 100%; height: 5px; margin: 22px 0 7px; border-radius: 5px; background: #5b4650; cursor: pointer; }
    .fill { width: 0; height: 100%; border-radius: inherit; background: #fff; }
    .time { display: flex; justify-content: space-between; color: #b9aeb5; font-size: 11px; }
    .controls { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 16px; }
    button { border: 0; color: #fff; background: transparent; cursor: pointer; font-size: 19px; }
    #play { width: 44px; height: 44px; border-radius: 50%; color: #1b0e14; background: #fff; font-size: 20px; }
</style>
<div class="player">
    <div class="title">${escapeHtml(title)}</div>
    <div class="artist">${escapeHtml(artist)}</div>
    <div class="bar" id="bar"><div class="fill" id="fill"></div></div>
    <div class="time"><span id="current">0:00</span><span id="duration">${escapeHtml(duration || '0:00')}</span></div>
    <div class="controls">
        <button id="back" aria-label="Mundur 10 detik">-10</button>
        <button id="play" aria-label="Play">&#9654;</button>
        <button id="forward" aria-label="Maju 10 detik">+10</button>
    </div>
</div>
<audio id="audio" preload="metadata" src="${escapeHtml(audioSrc)}"></audio>
<script>
(function () {
    const audio = document.getElementById('audio');
    const play = document.getElementById('play');
    const bar = document.getElementById('bar');
    const fill = document.getElementById('fill');
    const current = document.getElementById('current');
    const duration = document.getElementById('duration');
    const formatTime = value => {
        value = Math.max(0, Math.floor(Number(value) || 0));
        return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
    };
    const update = () => {
        const total = Number(audio.duration) || 0;
        const position = Number(audio.currentTime) || 0;
        fill.style.width = total ? (position / total * 100) + '%' : '0%';
        current.textContent = formatTime(position);
        if (total) duration.textContent = formatTime(total);
    };
    play.addEventListener('click', async () => {
        try {
            if (audio.paused) { await audio.play(); play.textContent = '||'; }
            else { audio.pause(); play.textContent = '\\u25b6'; }
        } catch { play.textContent = '\\u25b6'; }
    });
    document.getElementById('back').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
    document.getElementById('forward').addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
    bar.addEventListener('click', event => {
        if (!audio.duration) return;
        const rect = bar.getBoundingClientRect();
        audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
    });
    audio.addEventListener('timeupdate', update);
    audio.addEventListener('loadedmetadata', update);
    audio.addEventListener('ended', () => { play.textContent = '\\u25b6'; update(); });
})();
</script>`;
}

function createMusicPlayer({ title, artist, duration, imageSrc = '', lyrics = [] }) {
        const safeTitle = escapeHtml(title);
        const safeArtist = escapeHtml(artist);
        const safeDuration = escapeHtml(duration || '0:00');
        const safeImage = escapeHtml(imageSrc);
        const lyricsJson = Buffer.from(JSON.stringify(Array.isArray(lyrics) ? lyrics : []), 'utf8').toString('base64');

        return `
<style>
    :root { --ink:#fff; --muted:#b9b1b6; }
    * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    html, body { background:transparent; color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; }
    .wrap { display:flex; justify-content:center; padding:10px; }
    .player { position:relative; width:100%; max-width:330px; overflow:hidden; border-radius:18px; background:#1a0d12; box-shadow:0 18px 40px rgba(0,0,0,.5); }
    .bg { position:absolute; inset:-30%; width:160%; height:160%; object-fit:cover; filter:blur(38px) saturate(1.5); opacity:.85; }
    .veil { position:absolute; inset:0; background:linear-gradient(180deg,rgba(20,8,12,.65),rgba(20,8,12,.8) 45%,rgba(12,5,8,.96)); pointer-events:none; }
    .content { position:relative; padding:16px 18px 18px; }
    .head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px; }
    .head__icon { width:18px; height:18px; flex:none; opacity:.85; }
    .head__mid { flex:1; min-width:0; text-align:center; }
    .head__from { color:var(--muted); font-size:9px; letter-spacing:.14em; text-transform:uppercase; }
    .head__album,.info__artist { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .head__album { margin-top:2px; font-size:12px; font-weight:600; }
    .poster { width:100%; aspect-ratio:1; overflow:hidden; border-radius:10px; background:rgba(255,255,255,.06); margin-bottom:14px; }
    .poster img { width:100%; height:100%; display:block; object-fit:cover; }
    .info { display:flex; justify-content:space-between; gap:10px; margin-bottom:10px; }
    .info__names { min-width:0; }
    .info__title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:17px; font-weight:600; line-height:1.3; }
    .info__artist { margin-top:3px; color:var(--muted); font-size:12px; }
    .mini-lyrics { height:82px; overflow:hidden; margin-bottom:10px; mask-image:linear-gradient(180deg,transparent,black 18%,black 82%,transparent); }
    .lyrics-text { display:flex; flex-direction:column; gap:5px; padding:28px 0; transition:transform .35s ease; will-change:transform; }
    .lyric-line { color:rgba(255,255,255,.4); font-size:10.5px; line-height:1.4; opacity:.75; }
    .lyric-line.is-active { color:#fff; font-size:12px; font-weight:700; opacity:1; }
    .lyrics-empty { color:var(--muted); font-size:10.5px; }
    .bar { position:relative; height:4px; margin-bottom:6px; border-radius:4px; background:rgba(255,255,255,.22); }
    .bar__fill { position:absolute; inset:0 auto 0 0; width:0; border-radius:4px; background:#fff; }
    .bar__dot { position:absolute; top:50%; left:0; width:11px; height:11px; border-radius:50%; background:#fff; transform:translate(-50%,-50%); }
    .time { display:flex; justify-content:space-between; margin-bottom:12px; color:var(--muted); font-size:11px; }
    .controls { display:flex; align-items:center; justify-content:space-between; }
    button { border:0; background:none; color:#fff; cursor:pointer; }
    .ctrl { width:34px; height:34px; font-size:18px; }
    .play { width:52px; height:52px; border-radius:50%; background:#fff; color:#12070b; font-size:22px; }
    .note { margin-top:12px; color:var(--muted); font-size:10px; text-align:center; }
</style>
<div class="wrap"><div class="player">
    <img class="bg" src="${safeImage}" alt=""><div class="veil"></div><div class="content">
        <div class="head"><span class="head__icon">⌄</span><div class="head__mid"><div class="head__from">YT Music Audio</div><div class="head__album">${safeArtist}</div></div><span class="head__icon">⋮</span></div>
        <div class="poster"><img src="${safeImage}" alt="${safeTitle}"></div>
        <div class="info"><div class="info__names"><div class="info__title">${safeTitle}</div><div class="info__artist">${safeArtist}</div></div><button class="ctrl" id="heart">♡</button></div>
        <div class="mini-lyrics" id="mini-lyrics"><div class="lyrics-text" id="lyrics-text"></div></div>
        <div class="bar"><div class="bar__fill" id="fill"></div><div class="bar__dot" id="dot"></div></div>
        <div class="time"><span id="cur">0:00</span><span id="dur">${safeDuration}</span></div>
        <div class="controls"><button class="ctrl">♪</button><button class="ctrl" aria-label="skip back">↶<small>10</small></button><button class="play" aria-label="play">▶</button><button class="ctrl" aria-label="skip forward"><small>10</small>↷</button><button class="ctrl" id="restart">↻</button></div>
        <div class="note">Audio dikirim terpisah, kalau mau singkron silahkan klik secara bersamaan tombol di play di atas dan pesan player musik di bawah</div>
    </div>
</div></div>
<script>
(function(){
    const lyricsText=document.getElementById('lyrics-text');
    const fill=document.getElementById('fill');
    const dot=document.getElementById('dot');
    const cur=document.getElementById('cur');
    const dur=document.getElementById('dur');
    const playBtn=document.querySelector('.play');
    const backBtn=document.querySelector('[aria-label="skip back"]');
    const forwardBtn=document.querySelector('[aria-label="skip forward"]');
    const restartBtn=document.getElementById('restart');
    const bar=document.querySelector('.bar');
    const binary=atob('${lyricsJson}'); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const lyrics=JSON.parse(new TextDecoder('utf-8').decode(bytes));
    lyricsText.innerHTML=lyrics.length?lyrics.map((line,index)=>'<div class="lyric-line" data-index="'+index+'">'+String(line.text||'').replace(/[&<>]/g,'')+'</div>').join(''):'<div class="lyrics-empty">Lirik belum tersedia untuk lagu ini.</div>';

    const maxLyricTime = lyrics.length ? Math.max(...lyrics.map(line => Number(line.time) || 0)) : 0;
    const parsedDuration = (function() {
        const parts = '${safeDuration}'.split(':');
        if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
        return 0;
    })();

    const state = {
        isPlaying: false,
        currentTime: 0,
        duration: Math.max(parsedDuration, maxLyricTime > 0 ? maxLyricTime + 15 : 180)
    };

    const formatTime = (seconds) => {
        const total = Math.max(0, Number(seconds) || 0);
        const mins = Math.floor(total / 60);
        const secs = Math.floor(total % 60);
        return mins + ':' + String(secs).padStart(2, '0');
    };

    const updateLyricsPosition = (position) => {
        const activeIndex = lyrics.reduce((result, line, index) => (line && Number(position) >= Number(line.time) ? index : result), -1);
        [...lyricsText.children].forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
        if (activeIndex >= 0) {
            lyricsText.style.transform = 'translateY(-' + Math.max(0, activeIndex * 17 - 28) + 'px)';
        } else {
            lyricsText.style.transform = 'translateY(0px)';
        }
    };

    const updateProgress = () => {
        const pct = state.duration ? Math.min(100, (state.currentTime / state.duration) * 100) : 0;
        fill.style.width = pct + '%';
        dot.style.left = pct + '%';
        cur.textContent = formatTime(state.currentTime);
        dur.textContent = formatTime(state.duration);
        updateLyricsPosition(state.currentTime);
    };

    let timer = null;
    const stopTimer = () => {
        if (timer) clearInterval(timer);
        timer = null;
    };
    const startTimer = () => {
        stopTimer();
        timer = setInterval(() => {
            if (!state.isPlaying) return;
            state.currentTime = Math.min(state.duration, state.currentTime + 1);
            updateProgress();
            if (state.currentTime >= state.duration) {
                state.isPlaying = false;
                playBtn.textContent = '▶';
                stopTimer();
            }
        }, 1000);
    };

    playBtn.addEventListener('click', () => {
        state.isPlaying = !state.isPlaying;
        playBtn.textContent = state.isPlaying ? '❚❚' : '▶';
        if (state.isPlaying) startTimer(); else stopTimer();
    });

    backBtn.addEventListener('click', () => {
        state.currentTime = Math.max(0, state.currentTime - 10);
        updateProgress();
    });

    forwardBtn.addEventListener('click', () => {
        state.currentTime = Math.min(state.duration, state.currentTime + 10);
        updateProgress();
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            state.currentTime = 0;
            state.isPlaying = false;
            playBtn.textContent = '▶';
            stopTimer();
            updateProgress();
        });
    }

    bar.addEventListener('click', (event) => {
        const rect = bar.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        state.currentTime = ratio * state.duration;
        updateProgress();
    });

    updateProgress();
})();
</script>`;
}

function generateVerificationMetadata() {
    const sigMaterial = Buffer.from('JH.FionyVerseV1.0-VerificationSignature.Metadata');
    const certMaterial = Buffer.from('JH.FionyVerseV1.0-CertificateChain.Metadata');

    const signature = Buffer.concat([
        sigMaterial,
        crypto.randomBytes(64 - sigMaterial.length)
    ]).toString('base64');

    const certificateChain = [
        Buffer.concat([
            certMaterial,
            crypto.randomBytes(684 - certMaterial.length)
        ]).toString('base64'),
        Buffer.concat([
            certMaterial,
            crypto.randomBytes(892 - certMaterial.length)
        ]).toString('base64')
    ];

    return {
        proofs: [{
            version: 1,
            useCase: 1,
            signature,
            certificateChain
        }]
    };
}

async function sendHtml(conn, m, html, fallbackText = 'rich message berhasil dikirim.') {
    const target = m.chat || m.from;
    if (!conn?.message?.send) {
        throw new Error('API pengiriman pesan Zapo tidak tersedia.');
    }

    const canSend = typeof conn?.isConnected === 'function' ? conn.isConnected() : true;
    if (!canSend) return false;

    const responseId = crypto.randomUUID();
    const payload = {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
                messageDisclaimerText: '',
                verificationMetadata: generateVerificationMetadata(),
                botResponseId: responseId
            }
        },
        botForwardedMessage: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [{
                        messageType: 2,
                        messageText: 'Rich'
                    }],
                    unifiedResponse: {
                        data: Buffer.from(JSON.stringify({
                            __typename: 'GenAIUnifiedResponse',
                            response_id: responseId,
                            sections: [{
                                __typename: 'GenAIUnifiedResponseSection',
                                view_model: {
                                    __typename: 'GenAISingleLayoutViewModel',
                                    primitive: {
                                        __typename: 'GenAIaeacdsnwHtmlPrimitive',
                                        payload: html,
                                        trusted_sources: []
                                    }
                                }
                            }]
                        })).toString('base64')
                    },
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
                        forwardOrigin: 4
                    }
                }
            }
        }
    };

    try {
        await conn.message.send(target, payload, {
            id: responseId,
            messageId: responseId,
            additionalAttributes: { type: 'text' }
        });
        return true;
    } catch (err) {
        const text = fallbackText || 'rich message berhasil dikirim.';
        const canFallbackSend = typeof conn?.isConnected === 'function' ? conn.isConnected() : true;
        if (!canFallbackSend) return false;

        try {
            await conn.message.send(target, { text }, {
                additionalAttributes: { type: 'text' }
            });
            return false;
        } catch {
            try {
                await m.reply(text);
            } catch {
                // no-op
            }
            return false;
        }
    }
}

async function replyWhenConnected(conn, m, text) {
    const canSend = typeof conn?.isConnected === 'function' ? conn.isConnected() : true;
    if (!canSend) return null;

    try {
        return await m.reply(text);
    } catch (error) {
        if (/client is not connected|not connected/i.test(String(error?.message || error))) return null;
        throw error;
    }
}

async function editWhenConnected(status, text) {
    if (!status?.edit) return null;

    try {
        return await status.edit(text);
    } catch (error) {
        if (/client is not connected|not connected/i.test(String(error?.message || error))) return null;
        throw error;
    }
}

const handler = async (m, { conn, args, isOwner, text, __dirname, thisClass, usedPrefix, command }) => {

        if (typeof conn?.isConnected === 'function' && !conn.isConnected()) return;
    const query = text?.trim();

    switch (command) {
        case 'ytmp3':
        case 'ytmusic':
        case 'ytmusik':
        case 'play': {
            let status;
            let audioPath;
            let videoId = extractVideoId(query);
            let info = null;

            if (!videoId) {
                if (!args[0]) throw `Masukkan link youtube atau kata kunci pencarian!\nContoh:\n${usedPrefix}${command} judul lagu`;
                status = await replyWhenConnected(conn, m, 'Tunggu kak, sedang menelusuri...');
                const results = await searchVideos(query, 5);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;
                videoId = resolveSearchVideoId(results[0]);
                if (!videoId) throw 'Hasil pencarian YouTube tidak memiliki ID video yang valid.';
                info = results[0];
            } else {
                status = await replyWhenConnected(conn, m, 'Tunggu kak, sedang mengambil data...');
            }

            try {
                if (!info) {
                    const videoInfo = await getVideoInfo(videoId);
                    info = videoInfo;
                }

                const url = `https://www.youtube.com/watch?v=${videoId}`;
                const title = info.title || 'Audio';
                const duration = info.duration ? formatDuration(info.duration) : '';
                const uploadDate = info.upload_date ? `${info.upload_date.slice(6, 8)}/${info.upload_date.slice(4, 6)}/${info.upload_date.slice(0, 4)}` : '';
                const caption = `${title}${duration ? `\nDurasi: ${duration}` : ''}${uploadDate ? `\nDiupload: ${uploadDate}` : ''}\nLink: ${url}`;

                await editWhenConnected(status, `Berhasil Menemukan *${title}*,\nSedang mendownload...`);

                
                audioPath = path.join(tmpDir, `${videoId}_${Date.now()}.m4a`);
                await ytdlp.download(url, {
                    ...(await getYtdlpOptions()),
                    cookies: getCookies(),
                    format: 'bestaudio[ext=m4a]/bestaudio',
                    output: audioPath,
                });

                await editWhenConnected(status, 'Mengirim...');
                const audioBuffer = await fs.promises.readFile(audioPath);
                const thumbnailUrl = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                const thumbnail = await fetch(thumbnailUrl)
                    .then(response => response.arrayBuffer())
                    .then(buffer => Buffer.from(buffer))
                    .catch(() => Buffer.alloc(0));
                const artist = info.uploader || info.channel || 'YouTube';
                const lyrics = await getLyrics(title, artist, info.duration || 0);
                const html = createMusicPlayer({
                    title,
                    artist,
                    duration: duration || '0:00',
                    imageSrc: thumbnail.length ? `data:image/jpeg;base64,${thumbnail.toString('base64')}` : '',
                    lyrics
                });
                await sendHtml(conn, m, html, caption);
                await conn.sendMedia(m.from, audioBuffer, m, {
                    mimetype: 'audio/mp4',
                    fileName: `${title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
                    caption: `Audio: ${title}`
                });
                await editWhenConnected(status, caption);
            } catch (e) {
                await editWhenConnected(status, `Gagal: ${e.message || e}`);
                throw e;
            } finally {
                if (audioPath) await fs.promises.rm(audioPath, { force: true }).catch(() => {});
            }
            break;
        }

        case 'ytmp4':
        case 'ytvideo':
        case 'ytv':
        case 'ythd': {
            let status;
            let outputPath;
            const [searchQuery, resolusi] = query ? query.split('|') : ['', ''];
            let videoId = extractVideoId(searchQuery);
            let info = null;

            if (!videoId) {
                if (!args[0]) throw `Masukkan link youtube atau kata kunci pencarian!\nContoh:\n${usedPrefix}${command} judul|480p\natau\n${usedPrefix}${command} https://youtu.be/xxxxxx|480p`;
                status = await m.reply('Tunggu kak, sedang menelusuri...');
                const results = await searchVideos(searchQuery, 5);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + searchQuery;
                videoId = resolveSearchVideoId(results[0]);
                if (!videoId) throw 'Hasil pencarian YouTube tidak memiliki ID video yang valid.';
                info = results[0];
            } else {
                status = await m.reply('Tunggu kak, sedang mengambil data...');
            }

            try {
                if (!info) {
                    const videoInfo = await getVideoInfo(videoId);
                    info = videoInfo;
                }

                const title = info.title || 'Video';
                const author = info.uploader || info.channel || 'Tidak diketahui';
                const duration = info.duration ? formatDuration(info.duration) : 'Tidak diketahui';
                const views = formatViews(info.view_count);
                const uploadDate = info.upload_date ? `${info.upload_date.slice(6, 8)}/${info.upload_date.slice(4, 6)}/${info.upload_date.slice(0, 4)}` : 'Tidak diketahui';
                const description = info.description || '';
                const url = `https://www.youtube.com/watch?v=${videoId}`;

                let cap = `*${title}*\n\n` +
                    `*Author:* ${author}\n` +
                    `*Durasi:* ${duration}\n` +
                    `*Diupload:* ${uploadDate}\n` +
                    `*Views:* ${views}\n` +
                    `*Link:* ${url}\n\n` +
                    `${description}`;

                await status.edit(`Berhasil Menemukan *${title}*,\nSedang mendownload...`);

                const quality = resolusi ? resolusi.replace(/[^0-9]/g, '') : '480';
                outputPath = path.join(tmpDir, `${videoId}_${Date.now()}.mp4`);

                await ytdlp.download(url, {
                    ...(await getYtdlpOptions()),
                    cookies: getCookies(),
                    format: `bestvideo[height<=${quality}][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=${quality}][vcodec^=avc1]`,
                    output: outputPath,
                    mergeOutputFormat: 'mp4'
                });

                const fileSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);

                await status.edit(`Berhasil Mengunduh *${title}*\nSize: ${fileSize} MB,\nSedang mengirim...`);

                //const videoBuffer = await fs.promises.readFile(outputPath);
                await conn.sendMedia(m.from, outputPath, m, {
                    mimetype: 'video/mp4',
                    fileName: `${title.replace(/[\\/:*?"<>|]/g, '_')}.mp4`,
                    caption: cap
                });

            } catch (e) {
                if (status) await status.edit(`Gagal: ${e.message || e}`);
                throw e;
            } finally {
                if (outputPath) await fs.promises.rm(outputPath, { force: true }).catch(() => {});
            }
            break;
        }

        case 'yts': {
            if (!args[0]) throw `Masukkan kata kunci pencarian!\nContoh:\n${usedPrefix}${command} judul lagu`;
            const status = await m.reply('Tunggu kak, sedang menelusuri...');

            try {
                const results = await searchVideos(query, 10);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;

                let msg = `*Hasil Pencarian YouTube: ${query}*\n\n`;
                results.forEach((v, i) => {
                    msg += `${i + 1}. *${v.title || 'Unknown'}*\n`;
                    msg += `   Channel: ${v.uploader || v.channel || 'Unknown'}\n`;
                    msg += `   Durasi: ${v.duration ? formatDuration(v.duration) : '-'}\n`;
                    msg += `   Link: https://www.youtube.com/watch?v=${v.id}\n\n`;
                });
                msg += `\nUntuk download, ketik:\n${usedPrefix}play <link/judul>\n${usedPrefix}ytmp4 <link/judul>`;

                await status.edit(msg);
            } catch (e) {
                await status.edit(`Gagal: ${e.message || e}`);
                throw e;
            }
            break;
        }

        case 'ytinfo': {
            let status;
            let videoId = extractVideoId(query);
            if (!videoId) {
                if (!args[0]) throw `Masukkan link youtube atau kata kunci pencarian!\nContoh:\n${usedPrefix}${command} https://youtu.be/xxxxxx`;
                status = await m.reply('Tunggu kak, sedang menelusuri...');
                const results = await searchVideos(query, 1);
                if (!results || results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;
                videoId = resolveSearchVideoId(results[0]);
                if (!videoId) throw 'Hasil pencarian YouTube tidak memiliki ID video yang valid.';
            }

            try {
                const info = await getVideoInfo(videoId);
                const title = info.title || 'Unknown';
                const author = info.uploader || info.channel || 'Tidak diketahui';
                const duration = info.duration ? formatDuration(info.duration) : '-';
                const views = formatViews(info.view_count);
                const uploadDate = info.upload_date ? `${info.upload_date.slice(6, 8)}/${info.upload_date.slice(4, 6)}/${info.upload_date.slice(0, 4)}` : '-';
                const likes = info.like_count ? formatViews(info.like_count) : '-';
                const description = info.description || '';

                let msg = `*${title}*\n\n` +
                    `*Author:* ${author}\n` +
                    `*Durasi:* ${duration}\n` +
                    `*Views:* ${views}\n` +
                    `*Likes:* ${likes}\n` +
                    `*Diupload:* ${uploadDate}\n` +
                    `*Link:* https://www.youtube.com/watch?v=${videoId}\n\n` +
                    `${description.substring(0, 500)}${description.length > 500 ? '...' : ''}`;

                if (status) await status.edit('Mengirim informasi...');
                await conn.sendMedia(m.from, info.thumbnail, m, {
                    caption: msg,
                    mimetype: 'image/jpeg'
                });
            } catch (e) {
                if (status) await status.edit(`Gagal: ${e.message || e}`);
                throw e;
            }
            break;
        }

        case 'tesyt': {
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            if (!args[0]) throw `Masukkan link youtube!\nContoh:\n${usedPrefix}${command} https://youtu.be/xxxxxx`;

            try {
                const videoId = extractVideoId(query);
                if (!videoId) throw 'Link tidak valid';

                const info = await getVideoInfo(videoId);
                const formats = info.formats || [];

                let msg = `*Test Format: ${info.title}*\n\n`;
                const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.acodec === 'none').slice(0, 10);
                const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none').slice(0, 5);

                msg += `*Video Formats:*\n`;
                videoFormats.forEach(f => {
                    msg += `- ${f.format_id}: ${f.height}p (${f.ext}) ~${f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + 'MB' : 'unknown'}\n`;
                });

                msg += `\n*Audio Formats:*\n`;
                audioFormats.forEach(f => {
                    msg += `- ${f.format_id}: ${f.abr || '?'}kbps (${f.ext}) ~${f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + 'MB' : 'unknown'}\n`;
                });

                m.reply(msg);
            } catch (e) {
                m.reply(`Gagal: ${e.message || e}`);
                throw e;
            }
            break;
        }

        case 'setytcookie': {
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            const cookie = m.quoted ? m.quoted.msg.text : text ?? undefined;
            if (!cookie) throw `Silahkan reply pesan yang berisi cookie atau ketik ${usedPrefix}setytcookie cookie`;
            fs.writeFileSync(cookiePath, `${cookie}`);
            m.reply('Berhasil menyimpan cookie .ytdlp-cookies.txt');
            return thisClass.loadPlugin((new URL(import.meta.url)).pathname);
        }
    }
};

handler.command = /^tesyt|yts|ytinfo|setytcookie|ytmp3|play|ytmp4|ytvideo|ytv|ythd$/i;
handler.tags = ['downloader'];
handler.help = ['play', 'ytmp3', 'ytmp4', 'ytvideo', 'ythd url atau judul|resolusi', 'yts pencarian', 'ytinfo link', 'tesyt link (owner)'];
export default handler;
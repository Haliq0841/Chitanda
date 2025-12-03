import fs from 'fs'
import path from 'path'
import { Innertube, UniversalCache, YTNodes, Constants, Parser, Utils, Platform, ClientType } from 'youtubei.js'
import { BG } from 'bgutils-js';
import { JSDOM } from 'jsdom';
import { SabrStream } from 'googlevideo/sabr-stream';
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils';
import vm from 'node:vm';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough, pipeline } from 'stream';
Platform.shim.eval = async (data, env) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }
  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `
    (function() {
      ${data.output}
      return { ${properties.join(', ')} };
    })()
  `;

  const context = { exportedVars: {} };
  const script = new vm.Script(code);
  return script.runInNewContext(context);
};

let mess = null;
let isLogin = false;
const credentialsPath = (new URL('../../.credentials.json', import.meta.url)).pathname;
const cookiePath = (new URL('../../.yt-cookie.txt', import.meta.url)).pathname;
let client_type = 'WEB'; //WEB, ANDROID, TV, YTMUSIC. untuk masuk dengan credentials hanya bisa menggunkan client tv (akses sangat terbatas)
const yt = await Innertube.create({
    lang: 'id',
    user_agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`,
    client_type: client_type,
    cache: new UniversalCache(true),
    retrieve_player: true,
    device_category: 'desktop',
    enable_session_cache: true,
    generate_session_locally: true,
    cookie: client_type !== 'TV' && fs.existsSync(cookiePath) ? fs.readFileSync(cookiePath, 'utf-8') : undefined
});
    yt.session.on('update-credentials', ({ credentials }) => {
        console.log('Token diperbarui otomatis, simpan ulang ke file.');
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
    });
    yt.session.on('auth-pending', (data) => {
        console.log('Buka URL ini:', data.verification_url);
        console.log('Masukkan kode ini:', data.user_code);
        if (mess) mess.reply('Buka URL ini:\n' + data.verification_url + '\n\nMasukkan kode ini:\n' + data.user_code);
    });
    yt.session.on('auth', ({ credentials }) => {
        isLogin = true;
        console.log('Login berhasil, menyimpan kredensial...');
        if (mess) mess.reply('Login berhasil!');
        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
    });

const handler = async (m, { conn, args, isOwner, text, __dirname, thisClass, usedPrefix, command }) => {
    if (!isLogin && client_type === 'TV') {
        if (fs.existsSync(credentialsPath)) {
            const savedCreds = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
            await yt.session.signIn(savedCreds);
            console.log('Masuk dengan kredensial tersimpan (TV client).');
            isLogin = true;
        } else {
            if (!isOwner) throw 'Belum ada akun youtube silahkan minta owner untuk login dengan akun youtube terlebih dahulu';
            mess = m;
            await yt.session.signIn();
        }
    } else if (client_type !== 'TV') {
        if (command == 'setytcookie') {
            if (!isOwner) throw 'Command ini hanya bisa digunakan oleh owner!';
            const cookie =  m.quoted ?  m.quoted.msg.text : text ?? undefined
            if (!cookie) throw `Silahkan reply pesan yang berisi cookie atau ketik ${usedPrefix}setytcookie cookie`;
            fs.writeFileSync(cookiePath, `${cookie}`);
            m.reply('Berhasil menyimpan cookie .yt-cookie.txt');
            return thisClass.loadPlugin((new URL(import.meta.url)).pathname)
        } else if (!fs.existsSync(cookiePath)) {
            if (!isOwner) throw 'Belum ada cookie youtube silahkan minta owner untuk menambahkan cookie terlebih dahulu';
            return m.reply(`Silahkan tambahkan cookie youtube di file .yt-cookie.txt\nKetik ${usedPrefix}setytcookie <reply cookie>\n\nCara mendapatkan cookie:\n1. Buka browser (untuk Android bisa gunakan MS Edge)\n2. Klik titik 3 atau toolbar cari menu Extensi, install cookie-editor\n3. Buka youtube.com (Di sarankan menggunakan mode penyamaran)\n4.login dengan akun google kamu\n5. Setelah berhasil login buka salah satu video dulu, buka cookie-editor, lalu export cookie dalam format Header-String\n6. Salin semua isinya dan ketik ${usedPrefix}setytcookie <paste disini/reply pesan berisi cookie>`);
        } else {
            isLogin = true;
        }
    }
    switch (command) {
        case 'ytmp3':
        case 'ytmusic':
        case 'ytmusik':
        case 'play':
            let url = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            let key;
            let published;
            if (!url) {
                if (args[0]) {
                    key = (await conn.sendMessage(m.from, {text: 'Tunggu kak, sedang menelusuri...'}, { quoted: m })).key;
                    let { results } = await yt.search(text);
                    if (results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + text;
                    let video = results.find(video => video.type.toLowerCase() === 'video');
                    if (!video) throw 'Tidak ditemukan hasil untuk: ' + text;
                    url = [
                        '', video.id
                    ]
                    published = video.published?.text;
                } else {
                    throw 'Masukkan link youtube atau kata kunci pencarian!';
                }
            } else {
                key = (await conn.sendMessage(m.from, {text: 'Tunggu kak, sedang mengambil data...'}, { quoted: m })).key;
            }
            let videoId = url[1];
            if (!videoId) throw 'Link tidak valid, pastikan linknya benar';
            url = `https://www.youtube.com/watch?v=${videoId}`;
            try {
                const { basic_info } = await yt.music.getInfo(videoId);
                let caption = `${basic_info.title}`;
                if (published)
                    caption += `\nDiupload: ${published}`
                else
                    caption += `\nDurasi: ${formatDuration(basic_info.duration)}`;
                await conn.sendMessage(m.from, {text: `Berhasil Menemukan *${basic_info.title}*,\nSedang mendownload...`, edit: key });
                const stream = await yt.download(`${videoId}`, {
                    type: 'audio',
                    quality: 'best',
                    format: 'mp4',
                    client: 'YTMUSIC'
                });
                const inputStream = new PassThrough();
                for await (const chunk of Utils.streamToIterable(stream)) {
                  inputStream.write(chunk);
                }
                inputStream.end();
                await conn.sendMessage(m.from, {text: `lagu *${basic_info.title}* selesai di download, sedang konversi ke format mp3...`, edit: key });
                const chunks = [];
                await new Promise((resolve, reject) => {
                  ffmpeg(inputStream)
                    .format('mp3')
                    .on('error', reject)
                    .on('end', resolve)
                    .pipe()
                    .on('data', chunk => chunks.push(chunk));
                });
                const mp3Buffer = Buffer.concat(chunks);
                await conn.sendMessage(m.from, {text: `Mengirim...`, edit: key });
                await conn.sendMessage(m.from, { 
                audio: mp3Buffer, 
                mimetype: 'audio/mpeg', fileName: `${basic_info.title}.mp3`, contextInfo: {
                    externalAdReply: {
                        showAdAttribution: false,
                        renderLargerThumbnail: true,
                        mediaType:  2,
                        mediaUrl: url,
                        title: caption ,
                        body: basic_info.author,
                        sourceUrl: url,
                        thumbnail: await fetch(basic_info.thumbnail[0].url).then(v => v.arrayBuffer()).then(buf => Buffer.from(buf))
                    }
                }
            }, { quoted: m })
            } catch (e) {
                await conn.sendMessage(m.from, {text: `Gagal`, edit: key });
                throw e
            }
        break
        case 'ytmp4':
        case 'ytvideo':
        case 'ytv':
        case 'ythd':
            let urlv = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            let keyv;
            let searchData; 
            const [ query, resolusi] = text.split('|');
            if (!urlv) {
                if (args[0]) {
                    keyv = (await conn.sendMessage(m.from, {text: 'Tunggu kak, sedang menelusuri...'}, { quoted: m } )).key;
                    let { results } = await yt.search(query);
                    if (results.length === 0) throw 'Tidak ditemukan hasil untuk: ' + query;
                    let video = results.find(video => video.type.toLowerCase() === 'video');
                    if (!video) throw 'Tidak ditemukan hasil untuk: ' + query;
                    urlv = [
                        '', video.id
                    ]
                    searchData = results;
                } else {
                    throw 'Masukkan link youtube atau kata kunci pencarian!\nContoh:\n' + usedPrefix + command + ' judul|480p\natau\n' + usedPrefix + command + ' https://youtu.be/xxxxxx|480p';
                }
            } else {
                keyv = (await conn.sendMessage(m.from, {text: 'Tunggu kak, sedang mengambil data...'}, { quoted: m } )).key;
            }
            let videoIdv = urlv[1];
            if (!videoIdv) throw 'Link tidak valid, pastikan linknya benar';
            urlv = `https://www.youtube.com/watch?v=${videoIdv}`;
            try {
                const videoData = await yt.getInfo(videoIdv)
                let cap = `*${videoData.primary_info?.title?.text}*

*Author:* ${videoData.basic_info?.author || 'Tidak diketahui'}
*Durasi:* ${formatDuration(videoData.basic_info?.duration || 0)}
*Diupload:* ${videoData.primary_info?.relative_date?.text || 'Tidak diketahui'}
*Tanggal Upload:* ${videoData.primary_info?.published?.text || 'Tidak diketahui'}
*Views:* ${videoData.basic_info?.view_count || 'Tidak diketahui'}
*Link:* ${urlv}

${videoData.secondary_info?.description?.text || ''}`;
                await conn.sendMessage(m.from, {text: `Berhasil Menemukan *${videoData.primary_info?.title?.text}*,\nSedang mendownload...`, edit: keyv });
                //if (command === 'ythd') {
                    const OPTIONS = {
                      preferWebM: true,
                      preferOpus: true,
                      videoQuality: resolusi || '480p',
                      audioQuality: 'AUDIO_QUALITY_MEDIUM',
                      enabledTrackTypes: EnabledTrackTypes.VIDEO_AND_AUDIO
                    };
                    const { streamResults } = await createSabrStream(videoIdv, OPTIONS);
                    const { videoStream, audioStream, selectedFormats, videoTitle } = streamResults;
                    console.log(selectedFormats);
                    const videoPath = path.join(__dirname, './temp', `${createfileName(videoTitle, selectedFormats.videoFormat.mimeType)}`);
                    const audioPath = path.join(__dirname, './temp', `${createfileName(videoTitle, selectedFormats.audioFormat.mimeType)}`);
                    const video_audio_path = path.join(__dirname, './temp', `${videoData.primary_info?.title?.text}_output.mp4`);

                    const videoOutputStream = fs.createWriteStream(videoPath, { flags: 'w', encoding: 'binary' })
                    const audioOutputStream = fs.createWriteStream(audioPath, { flags: 'w', encoding: 'binary' })

                    await Promise.all([
                          videoStream.pipeTo(createStreamSink(selectedFormats.videoFormat, videoOutputStream)),
                          audioStream.pipeTo(createStreamSink(selectedFormats.audioFormat, audioOutputStream))
                        ]);

                    await mergeAudioAndVideo(video_audio_path, audioPath, videoPath);
                    fs.unlinkSync(videoPath);
                    fs.unlinkSync(audioPath);
                    await conn.sendMessage(m.from, {text: `Berhasil Mengunduh *${videoData.basic_info?.title}*\nSize: ${((await fs.promises.stat(video_audio_path)).size / (1024 * 1024)).toFixed(2)} MB,\nSedang Mengirim...`, edit: keyv });
                    await conn.sendMedia(m.from, video_audio_path, m, {
                        caption: cap,
                        jpegThumbnail: await fetch(videoData.basic_info.thumbnail[0].url).then(v => v.arrayBuffer()).then(buf => Buffer.from(buf))
                    })
                    fs.unlinkSync(video_audio_path);
 /*          
                  } else {
                    const stream = yt.download( `${videoIdv}`, {
                        type: 'video+audio',
                        quality: 'best',
                        format: 'mp4',
                        client: 'WEB'
                    });
                    
                    const dir = path.join(__dirname, './temp', `${videoData.basic_info.title}.mp4`);
                    const file = fs.createWriteStream(dir);

                    for await (const chunk of Utils.streamToIterable(stream)) {
                        file.write(chunk);
                    }
                    await conn.sendMessage(m.from, {text: `Berhasil Mengunduh *${videoData.basic_info?.title}*\nSize: ${(file.bytesWritten / (1024 * 1024)).toFixed(2)} MB,\nSedang Mengirim...`, edit: keyv });
                    await await conn.sendMedia(m.from, dir, m, {caption: cap})
                    fs.unlinkSync(dir);
                }
  */
            } catch (e) {
                await conn.sendMessage(m.from, {text: `Gagal`, edit: keyv });
                throw e
            }
        break;
        case 'yts':
            let res = await yt.search(text, {

            })
            throw res.results
        break
        case 'tesyt':
            
            break
        case 'ytinfo':
            const videoInfo = await yt.actions.execute('/player', {
    // You can add any additional payloads here, and they'll merge with the default payload sent to InnerTube.
                videoId: text,
                client: 'YTMUSIC', // InnerTube client to use.
                parse: true // tells YouTube.js to parse the response (not sent to InnerTube).
           });
            m.reply(JSON.stringify(videoInfo, null, 2));
        break
    }
}

handler.command = /^tesyt|yts|ytinfo|setytcookie|ytmp3|play|ytmp4|ytvideo|ytv|ythd$/i
handler.tags = ['downloader']
handler.help = ['play', 'ytmp3' ,'ytmp4', 'ytvideo', 'ythd url atau judul|resolusi']//.map(v => v + ' <link atau judul>')
export default handler

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  // tambahkan leading zero untuk detik < 10
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getBestResolutionLabel(streamingData) {
  const allFormats = [
...(streamingData.formats || []),
...(streamingData.adaptive_formats || [])
  ];

  const videoFormats = allFormats.filter(f => f.has_video);

  // Urutkan berdasarkan resolusi (tinggi) dan fps
  videoFormats.sort((a, b) => {
    const resA = a.height || 0;
    const resB = b.height || 0;
    const fpsA = a.fps || 0;
    const fpsB = b.fps || 0;

    if (resB!== resA) return resB - resA;
    return fpsB - fpsA;
});

  // Ambil label kualitas dari format terbaik
  const best = videoFormats.find(f => f.quality_label);
  return best? best.quality_label.split('p')[0].replace(/[^0-9]*/g, '') + 'p': '480p';
}

async function mergeAudioAndVideo(outputPath, audioPath, videoPath) {

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      //.outputOptions([ '-c:v copy', '-c:a copy', '-map 0:v:0', '-map 1:a:0' ])
      .outputFormat('mp4')
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(new Error(`Error merging files: ${err.message}`));
      })
      .save(outputPath);
  });
}

async function makePlayerRequest(innertube, videoId, reloadPlaybackContext) {
  const watchEndpoint = new YTNodes.NavigationEndpoint({ watchEndpoint: { videoId } });

  const extraArgs = {
    playbackContext: {
      adPlaybackContext: { pyv: true },
      contentPlaybackContext: {
        vis: 0,
        splay: false,
        lactMilliseconds: '-1',
        signatureTimestamp: innertube.session.player?.signature_timestamp
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };

  if (reloadPlaybackContext) {
    extraArgs.playbackContext.reloadPlaybackContext = reloadPlaybackContext;
  }

  return await watchEndpoint.call(innertube.actions, { ...extraArgs, parse: true });
}

function determineFileExtension(mimeType) {
  if (mimeType.includes('video')) {
    return mimeType.includes('webm') ? 'webm' : 'mp4';
  } else if (mimeType.includes('audio')) {
    return mimeType.includes('webm') ? 'webm' : 'm4a';
  }
  return 'bin';
}

function createfileName(title, mimeType) {
  const type = mimeType.includes('video') ? 'video' : 'audio';
  const sanitizedTitle = title?.replace(/[^a-z0-9]/gi, '_') || 'unknown';
  const extension = determineFileExtension(mimeType);
  const fileName = `${sanitizedTitle}.${type}.${extension}`;

  return fileName;
  /*
  return {
    stream: fs.createWriteStream(fileName, { flags: 'w', encoding: 'binary' }),
    filePath: fileName
  };
  */
}


function bytesToMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

/**
 * Creates a WritableStream that tracks download progress.
 */
function createStreamSink(format, outputStream) {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        outputStream.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      outputStream.end();
    }
  });
}

/**
 * Initializes Innertube client and sets up SABR streaming for a YouTube video.
 */
async function createSabrStream(videoId, options) {
  let opt = options || {};
  const innertube = yt;//await Innertube.create({ cache: new UniversalCache(true) });
  const webPoTokenResult = await generateWebPoToken(videoId);

  // Get video metadata.
  const playerResponse = await makePlayerRequest(innertube, videoId);
  const videoTitle = playerResponse.video_details?.title || 'Unknown Video';
  if (options.videoQuality === 'best') {
    options.videoQuality = getBestResolutionLabel(playerResponse.streaming_data);
  }

  console.info(`
    Title: ${videoTitle}
    Duration: ${playerResponse.video_details?.duration}
    Views: ${playerResponse.video_details?.view_count}
    Author: ${playerResponse.video_details?.author}
    Video ID: ${playerResponse.video_details?.id}
    Video quality: ${options.videoQuality}
  `);

  // Now get the streaming information.
  const serverAbrStreamingUrl = await innertube.session.player?.decipher(playerResponse.streaming_data?.server_abr_streaming_url);
  const videoPlaybackUstreamerConfig = playerResponse.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;

  if (!videoPlaybackUstreamerConfig) throw new Error('ustreamerConfig not found');
  if (!serverAbrStreamingUrl) throw new Error('serverAbrStreamingUrl not found');

  const sabrFormats = playerResponse.streaming_data?.adaptive_formats.map(buildSabrFormat) || [];

  const serverAbrStream = new SabrStream({
    formats: sabrFormats,
    serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig,
    poToken: webPoTokenResult.poToken,
    clientInfo: {
      clientName: parseInt(Constants.CLIENT_NAME_IDS[innertube.session.context.client.clientName]),
      clientVersion: innertube.session.context.client.clientVersion
    }
  });

  // Handle player response reload events (e.g, when IP changes, or formats expire).
  serverAbrStream.on('reloadPlayerResponse', async (reloadPlaybackContext) => {
    const playerResponse = await makePlayerRequest(innertube, videoId, reloadPlaybackContext);

    const serverAbrStreamingUrl = await innertube.session.player?.decipher(playerResponse.streaming_data?.server_abr_streaming_url);
    const videoPlaybackUstreamerConfig = playerResponse.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;

    if (serverAbrStreamingUrl && videoPlaybackUstreamerConfig) {
      serverAbrStream.setStreamingURL(serverAbrStreamingUrl);
      serverAbrStream.setUstreamerConfig(videoPlaybackUstreamerConfig);
    }
  });

  const { videoStream, audioStream, selectedFormats } = await serverAbrStream.start(opt);

  return {
    innertube,
    streamResults: {
      videoStream,
      audioStream,
      selectedFormats,
      videoTitle
    }
  };
}

async function generateWebPoToken(contentBinding) {
  const requestKey = 'O43z0dpjhgX20SCx4KAo';

  if (!contentBinding) {
    throw new Error('Could not get visitor data');
  }

  const dom = new JSDOM();
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });

  const bgConfig = {
    fetch: (input, init) => fetch(input, init),
    globalObj: globalThis,
    identifier: contentBinding,
    requestKey,
  };

  const bgChallenge = await BG.Challenge.create(bgConfig);
  if (!bgChallenge) {
    throw new Error('Could not get challenge');
  }

  const interpreterJavascript =
    bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;

  if (interpreterJavascript) {
    new Function(interpreterJavascript)();
  } else {
    throw new Error('Could not load VM');
  }

  const poTokenResult = await BG.PoToken.generate({
    program: bgChallenge.program,
    globalName: bgChallenge.globalName,
    bgConfig,
  });

  const placeholderPoToken = BG.PoToken.generatePlaceholder(contentBinding);

  return {
    visitorData: contentBinding,
    placeholderPoToken,
    poToken: poTokenResult.poToken,
  };
}
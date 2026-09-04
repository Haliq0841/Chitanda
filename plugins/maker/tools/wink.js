
import axios from "axios";
import FormData from "form-data";
import crypto from "node:crypto";
import sharp from "sharp";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

const BASE_URL = "https://wink.ai";
const STRATEGY_URL = "https://strategy.app.meitudata.com";

const CLIENT_ID = "1189857605";
const VERSION = "5.1.2";
const COUNTRY_CODE = "ID";
const CLIENT_LANGUAGE = "en_US";
const CLIENT_TIMEZONE = "Asia/Jakarta";

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

const GNUM = crypto.randomUUID();
const jar = new CookieJar();

await jar.setCookie(`_sm=${GNUM}; Path=/; Domain=wink.ai`, BASE_URL);
await jar.setCookie(
  `meitustat=${encodeURIComponent(JSON.stringify({ wgid: GNUM }))}; Path=/; Domain=wink.ai`,
  BASE_URL
);

const api = wrapper(axios.create({
  baseURL: BASE_URL,
  jar,
  withCredentials: true,
  validateStatus: () => true,
  headers: {
    accept: "*/*",
    origin: BASE_URL,
    referer: `${BASE_URL}/image-enhancer/upload`,
    "user-agent": UA,
    "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": "\"Android\"",
    ab_info: JSON.stringify({ ab_codes: [], version: "1.4.4" })
  }
}));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function makeTrace() {
  return `${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-1`;
}

function traceHeaders(isMsgIdQuery = false) {
  const transaction = isMsgIdQuery ? "%2F%3Alocale%2Feditor%2Frecent-task" : "GET%20%2F%5Blocale%5D%2Fimage-enhancer%2Fupload";
  const trace = makeTrace();
  return {
    "sentry-trace": trace,
    baggage: [
      "sentry-environment=release",
      "sentry-release=5.1.2%20(b60d25c477f43c6dfac4107810f26d442320f4f1)",
      "sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54",
      `sentry-trace_id=${trace.split("-")[0]}`,
      `sentry-transaction=${transaction}`,
      "sentry-sampled=true",
      "sentry-sample_rate=0.75"
    ].join(",")
  };
}

function baseParams(extra = {}) {
  return new URLSearchParams({
    client_id: CLIENT_ID, version: VERSION, country_code: COUNTRY_CODE,
    gnum: GNUM, client_language: CLIENT_LANGUAGE, client_channel_id: "", client_timezone: CLIENT_TIMEZONE,
    ...extra
  });
}

async function getMaatSign(suffix) {
  const params = baseParams({ suffix, type: "temp", count: "1" });
  const res = await api.get(`/api/file/get_maat_sign.json?${params.toString()}`, { headers: traceHeaders() });
  if (res.status >= 400 || res.data?.code !== 0) throw new Error(`get_maat_sign gagal`);
  return res.data.data;
}

async function getUploadPolicy(sign) {
  const params = new URLSearchParams({
    app: sign.app, count: String(sign.count), sig: sign.sig,
    sigTime: sign.sig_time, sigVersion: sign.sig_version, suffix: sign.suffix, type: sign.type
  });
  const res = await axios.get(`${STRATEGY_URL}/upload/policy?${params.toString()}`, {
    headers: { accept: "*/*", origin: BASE_URL, referer: `${BASE_URL}/`, "user-agent": UA },
    validateStatus: () => true
  });
  if (res.status >= 400 || !Array.isArray(res.data) || !res.data[0]?.qiniu) throw new Error(`upload policy gagal`);
  return res.data[0].qiniu;
}

async function uploadToQiniu(policy, buffer, mimeType, filename) {
  const form = new FormData();
  form.append("file", buffer, { filename, contentType: mimeType });
  form.append("token", policy.token);
  form.append("key", policy.key);
  form.append("fname", filename);

  const res = await axios.post(policy.url, form, {
    headers: form.getHeaders({ origin: BASE_URL, referer: `${BASE_URL}/`, "user-agent": UA, accept: "*/*" }),
    maxBodyLength: Infinity, maxContentLength: Infinity, validateStatus: () => true
  });
  if (res.status >= 400) throw new Error(`upload qiniu gagal HTTP ${res.status}`);
  return { file_key: policy.key, source_url: res.data.url || res.data.data || policy.data };
}

async function getMetaInfo(fileKey) {
  const body = baseParams({ file_key: fileKey });
  const res = await api.post("/api/file/meta_info.json", body.toString(), {
    headers: { ...traceHeaders(), "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }
  });
  return res.data?.data;
}

async function calcNeedBeans(taskType, contentType) {
  const typeParams = JSON.stringify({ is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2" });
  const rightDetail = JSON.stringify({ source: "1", touch_type: "4", function_id: "630", material_id: "63011", url: `${BASE_URL}/image-enhancer/upload` });
  const itemList = JSON.stringify([{ type: Number(taskType), ext_value: "2", content_type: Number(contentType), duration: 0, type_params: typeParams, right_detail: rightDetail }]);
  const body = baseParams({ item_list: itemList });

  await api.post("/api/subscribe/batch_calc_need_beans.json", body.toString(), {
    headers: { ...traceHeaders(), "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }
  });
}

async function delivery(sourceUrl, taskName, taskType, contentType) {
  const body = baseParams({
    type: taskType, content_type: contentType, source_url: sourceUrl,
    type_params: JSON.stringify({ is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2" }),
    right_detail: JSON.stringify({ source: "1", touch_type: "4", function_id: "630", material_id: "63011", url: `${BASE_URL}/image-enhancer/upload` }),
    ext_params: JSON.stringify({ task_name: taskName, records: taskType }),
    with_prepare: "1"
  });

  const res = await api.post("/api/meitu_ai/delivery.json", body.toString(), {
    headers: { ...traceHeaders(), "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }
  });
  if (res.status >= 400 || res.data?.code !== 0) throw new Error(`delivery gagal`);
  return res.data.data || {};
}

async function queryBatch(msgId) {
  const params = baseParams({ msg_ids: msgId });
  const res = await api.get(`/api/meitu_ai/query_batch.json?${params.toString()}`, {
    headers: { ...traceHeaders(true), referer: `${BASE_URL}/image-enhancer/upload` }
  });
  if (res.status >= 400 || res.data?.code !== 0) throw new Error(`query batch gagal`);
  return res.data.data;
}

async function waitResult(firstMsgId, maxTry = 120, delayMs = 3500) {
  let msgId = firstMsgId;
  for (let i = 1; i <= maxTry; i++) {
    const data = await queryBatch(msgId);
    
    const item = data?.item_list?.[0];
    const resultValue = item?.result?.result || "";
    const realMsgId = item?.result?.msg_id || item?.msg_id || "";
    let nextMsgId = "";
    if (resultValue && resultValue !== msgId && !resultValue.startsWith("http")) nextMsgId = resultValue;
    else if (realMsgId && realMsgId !== msgId && !realMsgId.startsWith("wpr_")) nextMsgId = realMsgId;

    if (nextMsgId) {
      msgId = nextMsgId;
      await sleep(1000);
      continue;
    }

    const url = item?.result?.media_info_list?.[0]?.media_data || "";
    const errorCode = item?.result?.error_code;
    const errorMsg = item?.result?.error_msg;

    if (url && url.startsWith("http") && errorCode === 0) return url;
    if (errorCode && errorCode !== 29901 && errorCode !== 0) throw new Error(`Task gagal: ${errorCode} ${errorMsg || ""}`);

    await sleep(delayMs);
  }
  throw new Error(`Waktu pemrosesan habis (Timeout)`);
}

// --- CONTEXT HANDLER BOT ---
const handler = async (m, { conn, args, usedPrefix, command }) => {
  const q = m.quoted ? m.quoted : m;
  const mime = (q.msg || q).mimetype || "";

  let isVideo = mime.startsWith("video/");
  let isImage = mime.startsWith("image/");

  if (!isImage && !isVideo) {
    return m.reply(
      `Kirim atau balas media dengan perintah *${usedPrefix + command} [angka]*\n\n` +
      `*Opsi Kualitas (Khusus Foto):*\n` +
      `1️⃣ *${usedPrefix + command} 1* : Standard Enhance\n` +
      `2️⃣ *${usedPrefix + command} 2* : Ultra HD (Internal Upscale 2x)\n` +
      `3️⃣ *${usedPrefix + command} 3* : Extreme HD (Internal Upscale 3x)\n\n` +
      `*Untuk Video:* Angka akan diabaikan dan otomatis diproses pada mode Video HD.`
    );
  }

  // Parse multiplier dari user (Default 1, Max 4 untuk keamanan RAM VPS)
  let multiplier = parseInt(args[0]);
  if (isNaN(multiplier) || multiplier < 1) multiplier = 1;
  if (multiplier > 4) multiplier = 4;

  const TASK_TYPE = isVideo ? "11" : "12";
  const CONTENT_TYPE = isVideo ? "2" : "1";
  const suffix = isVideo ? ".mp4" : ".jpg";
  const filename = isVideo ? "video.mp4" : "image.jpg";
  const mediaLabel = isVideo ? "Video" : `Foto [Mode: ${multiplier >= 2 ? 'Ultra HD ' + multiplier + 'x' : 'Standard'}]`;

  await m.reply(`Sedang memproses ${isVideo ? 'Video' : 'Foto'} via Wink AI HD, mohon tunggu...`);

  try {
    let mediaBuffer = await q.download?.() || await conn.downloadMediaMessage(q);
    if (!mediaBuffer) throw new Error(`Gagal mengambil media dari WhatsApp.`);

    // ALGORITMA MULTIPLIER INTERNAL (KHUSUS FOTO)
    if (isImage && multiplier > 1) {
      try {
        const img = sharp(mediaBuffer);
        const metadata = await img.metadata();
        if (metadata.width) {
          const newWidth = Math.round(metadata.width * multiplier);
          mediaBuffer = await img
            .resize({ width: newWidth, kernel: sharp.kernel.lanczos3 })
            .toBuffer();
        }
      } catch (e) {
        console.error("Gagal melakukan resize internal:", e);
      }
    }

    const taskName = `Wink-Enhancer-${isVideo ? 'Video' : 'Foto'}-${crypto.randomBytes(4).toString("hex")}`;

    // Pipeline Wink AI Engine
    const sign = await getMaatSign(suffix);
    const policy = await getUploadPolicy(sign);
    const uploaded = await uploadToQiniu(policy, mediaBuffer, mime, filename);

    await getMetaInfo(uploaded.file_key);
    await calcNeedBeans(TASK_TYPE, CONTENT_TYPE);

    const task = await delivery(uploaded.source_url, taskName, TASK_TYPE, CONTENT_TYPE);
    const firstMsgId = task.msg_id || task.prepare_msg_id;

    if (!firstMsgId) throw new Error("Gagal memperoleh ID antrean (msg_id) dari server.");

    // Polling antrean
    const resultUrl = await waitResult(firstMsgId, isVideo ? 150 : 80, isVideo ? 4000 : 3000);

    // Kirim Balik Hasil Media
    if (isVideo) {
      await conn.message.send(m.chat, { type: 'video', media: resultUrl, mimetype: 'video/mp4', caption: "✨ *Wink Video HD Berhasil diproses!*" }, { quote: m });
    } else {
      await conn.message.send(m.chat, { type: 'image', media: resultUrl, mimetype: 'image/jpeg', caption: `✨ *Wink Foto HD Berhasil diproses (Internal Scale: ${multiplier}x)!*` }, { quote: m });
    }

  } catch (err) {
    console.error(err);
    throw `❌ *Error:* ${err.message || err}`
  }
};

handler.help = ["wink <angka>", "hd <angka>", "vhd"];
handler.tags = ["tools", "ai"];
handler.command = /^(wink|hd|vhd|unblur)$/i;
handler.limit = true;

export default handler;

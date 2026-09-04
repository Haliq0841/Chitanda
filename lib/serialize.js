/*
@amiruldev20
*/

/* module external */
import {
    WaClient,
    ConsoleLogger,
    createStore,
} from 'zapo-js'
import { createMediaProcessor } from '@zapo-js/media-utils'
import path from "path"
import fs from "fs"
import pino from "pino"
//import file_type from "file-type"
//const  fileTypeFromBuffer  = file_type.fileTypeFromBuffer?? file_type.fromBuffer
import { fileTypeFromBuffer } from "file-type"

/* module internal */
import * as func from "./function.js"
import { imageToWebp, videoToWebp, writeExifImg, writeExifVid } from "./exif.js"
import { resolveDatabaseJid } from "./identity.js"

function escapeRegExp(string) {
    return string.replace(/[.*=+:\-?^${}()|[\]\\]|\s/g, '\\$&')
}

function rand(length = 32) {
    const chars = '0123456789ABCDEF'
    let result = ''
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length)
        result += chars[randomIndex]
    }
    return result
}

/* custom client */
const jidNormalizedUser = (jid) => {
    if (!jid) return jid
    const value = String(jid).trim()
    if (!value) return value
    const [user, server] = value.split('@')
    if (!server) return value
    return `${user}@${server}`
}

const jidDecode = (jid) => {
    if (!jid) return null
    const value = String(jid).trim()
    const [user, server] = value.split('@')
    return { user, server: server || 's.whatsapp.net' }
}

const normalizeOptionalJid = (jid) => {
    const value = jidNormalizedUser(jid)
    return typeof value === 'string' && value.trim() ? value : undefined
}


const areJidsSameUser = (a, b) => {
    if (!a || !b) return false
    return jidNormalizedUser(a).split('@')[0] === jidNormalizedUser(b).split('@')[0]
}

const parsePhoneNumber = number => {
    let cleaned = ("" + number).replace(/\D/g, "")
    if (cleaned.startsWith("62")) {
        if (cleaned.length >= 11 && cleaned.length <= 13) {
            return `+${cleaned.slice(0, 2)} ${cleaned.slice(
                2,
                6
            )} ${cleaned.slice(6, 10)} ${cleaned.slice(10)}`
        } else if (cleaned.length === 10) {
            return `+${cleaned.slice(0, 2)} ${cleaned.slice(
                2,
                4
            )} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`
        }
    } else if (cleaned.startsWith("1")) {
        if (cleaned.length === 10) {
            return `+1 ${cleaned.slice(0, 3)}-${cleaned.slice(
                3,
                6
            )}-${cleaned.slice(6)}`
        } else if (cleaned.length === 11 && cleaned.startsWith("1")) {
            return `+${cleaned.slice(0, 1)} ${cleaned.slice(
                1,
                4
            )}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
        }
    }

    return number
}

export function Client(db, options = {}) {
    const logger = options.logger ?? new ConsoleLogger('error')
    const store = options.store ?? createStore()
    options.media = {
        processor: createMediaProcessor(),
        generateThumbnail: true,
        generateWaveform: true,
        normalizeVoiceNote: true
    }
    const sock = new WaClient({ ...options, store, sessionId: options.sessionId ?? 'default' }, logger)
    sock.user = { id: null, name: '' }
    const normalizeTextPayload = (value) => {
        if (value == null) return ''
        if (typeof value === 'string') return value
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
        if (value instanceof Error) return value.message || String(value)
        if (typeof value === 'object') {
            if ('text' in value && value.text != null) return String(value.text)
            if ('caption' in value && value.caption != null) return String(value.caption)
            if ('body' in value && value.body != null) return String(value.body)
            try {
                return JSON.stringify(value)
            } catch {
                return String(value)
            }
        }
        return String(value)
    }

    const sanitizeMessagePayload = (payload) => {
        if (payload == null) return ''
        if (typeof payload === 'string' || typeof payload === 'number' || typeof payload === 'boolean' || typeof payload === 'bigint' || payload instanceof Error) {
            return normalizeTextPayload(payload)
        }
        if (payload && typeof payload === 'object') {
            const next = { ...payload }
            if (next.type === 'text' || next.type === undefined) {
                const textValue = next.text ?? next.caption ?? next.body ?? ''
                next.text = normalizeTextPayload(textValue)
                if (next.caption != null && typeof next.caption !== 'string') next.caption = normalizeTextPayload(next.caption)
                if (next.body != null && typeof next.body !== 'string') next.body = normalizeTextPayload(next.body)
                return next
            }
            if (next.text != null && typeof next.text !== 'string') next.text = normalizeTextPayload(next.text)
            if (next.caption != null && typeof next.caption !== 'string') next.caption = normalizeTextPayload(next.caption)
            if (next.body != null && typeof next.body !== 'string') next.body = normalizeTextPayload(next.body)
            return next
        }
        return normalizeTextPayload(payload)
    }

    sock.reply = async (jid, text, quoted, sendOptions = {}) => {
        const safeText = normalizeTextPayload(text)
        return sock.message.send(jid, safeText, {
            ...sendOptions,
            quote: quoted?.raw ?? quoted ?? sendOptions.quote ?? sendOptions.quoted,
        })
    }

    sock.sendMessage = async (jid, payload, options = {}) => {
        if (typeof payload === 'string' || typeof payload === 'number' || typeof payload === 'boolean' || payload == null) {
            return sock.message.send(jid, sanitizeMessagePayload(payload), options)
        }
        return sock.message.send(jid, sanitizeMessagePayload(payload), options)
    }

    if (sock.message && typeof sock.message.send === 'function') {
        const originalSend = sock.message.send.bind(sock.message)
        sock.message.send = async (jid, payload, options = {}) => {
            const safePayload = sanitizeMessagePayload(payload)
            return originalSend(jid, safePayload, options)
        }
    }
    sock.groupMetadata = async (jid) => sock.group?.queryGroupMetadata?.(jid) ?? null
    sock.readMessages = async (keys = []) => {
        if (typeof sock.message?.read === 'function') {
            return sock.message.read(keys)
        }
        return null
    }
    sock.getName = jid => {
        let id = jidNormalizedUser(jid)
        if (id.endsWith('g.us')) {
            let metadata = db.data.groupMetadata?.[id]
            return metadata ? metadata.subject : 'none'
        } else {
            let metadata = db.data.contacts[id]
            return (
                metadata?.name ||
                metadata?.verifiedName ||
                metadata?.notify ||
                parsePhoneNumber('+' + id.split('@')[0])
            )
        }
    }

    /* send contact */
    sock.sendContact = async (jid, number, quoted, options = {}) => {
        let list = [];
        for (let v of number) {
            if (v.endsWith('g.us')) continue;
            v = v.replace(/\D+/g, '');
            list.push({
                displayName: sock.getName(v + '@s.whatsapp.net'),
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${sock.getName(v + '@s.whatsapp.net')}\nFN:${sock.getName(v + '@s.whatsapp.net')}\nitem1.TEL;waid=${v}:${v}\nEND:VCARD`,
            });
        }
        return sock.message.send(
            jid,
            {
                type: 'text',
                text: '',
                contextInfo: {
                    quoted: quoted ? { key: quoted.key ?? { remoteJid: jid, id: quoted.id ?? rand(32), fromMe: false } } : undefined,
                },
                contacts: {
                    displayName: `${list.length} Contact`,
                    contacts: list,
                },
            },
            {
                quote: quoted?.raw ?? quoted,
                id: rand(32),
                ...options
            }
        );
    }

    /* adreply */
    sock.sendAd = async (jid, capt, quoted, opt = {}) => {
        return sock.message.send(
            jid,
            {
                type: 'text',
                text: capt || `${sock.user.name} Here`,
                contextInfo: {
                    isForwarded: true,
                    mentionedJid: sock.parseMention(capt),
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: opt?.idch || db.data.setting.ch_id,
                        serverMessageId: -1,
                        newsletterName: opt?.nch || db.data.setting.ch_name
                    },
                    externalAdReply: {
                        title: opt?.title || sock.user.name,
                        body: opt?.body || db.data.setting.dev,
                        mediaType: 2,
                        thumbnailUrl: opt?.thumbnailUrl || db.data.setting.logo
                    }
                }
            },
            {
                quote: (quoted?.raw ?? quoted) || null,
                id: rand(32),
                expirationSeconds: quoted ? quoted.expiration : undefined,
            }
        )
    }

    /* adreply large */
    sock.sendAdL = async (jid, capt, quoted, opt = {}) => {
        return sock.message.send(
            jid,
            {
                type: 'text',
                text: capt || `${sock.user.name} Here`,
                contextInfo: {
                    isForwarded: true,
                    mentionedJid: sock.parseMention(capt),
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: opt?.idch || db.data.setting.ch_id,
                        serverMessageId: -1,
                        newsletterName: opt?.nch || db.data.setting.ch_name
                    }
                }
            },
            {
                quote: (quoted?.raw ?? quoted) || null,
                id: rand(32),
                expirationSeconds: quoted ? quoted.expiration : undefined,
            }
        )
    }

    /* send button */
    sock.sendBtn = (jid, capt, foot, quoted, btn) => {
        const msg = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: {
                        body: {
                            text: capt
                        },
                        footer: {
                            text: foot
                        },
                        header: {
                            subtitle: "subtitle",
                            hasMediaAttachment: false
                        },
                        nativeFlowMessage: {
                            buttons: btn
                        },
                        contextInfo: {
                            quotedMessage: quoted.message,
                            participant: quoted.sender,
                            ...quoted.key
                        }
                    }
                }
            }
        }
        return sock.message.send(jid, msg)
    }

    /* send media */
    sock.sendMedia = async (jid, media, quoted = '', options = {}) => {
        const quoteTarget = quoted?.raw || (quoted && typeof quoted === 'object' && quoted.key ? quoted : null)
        const fetch = await func.getFile(media, false, options)
        const resolved = fetch || {}
        let mime = String(options?.mimetype || resolved?.mime || 'application/octet-stream')
        const buffer = Buffer.isBuffer(resolved?.data) ? resolved.data : Buffer.from(resolved?.data || media || '')
        const fileName = options?.fileName || resolved?.filename || `file-${Date.now()}`
        const caption = options?.caption || ''
        let mediaType = 'document'

        if (options?.asSticker) {
            mediaType = 'sticker'
        } else if (/image\//.test(mime)) {
            mediaType = 'image'
        } else if (/audio\//.test(mime)) {
            mediaType = 'audio'
        } else if (/video\//.test(mime)) {
            mediaType = 'video'
        }

        const basePayload = {
            type: mediaType,
            mimetype: mime,
            media: buffer,
            ...(caption ? { caption } : {}),
            ...(mediaType === 'document' && fileName ? { fileName } : {}),
        }

        return sock.message.send(jid, basePayload, {
            quote: quoteTarget,
            id: rand(32),
            expirationSeconds: quoteTarget?.expiration ?? options.expirationSeconds,
            ...options,
        })
    }

    sock.sendImageAsSticker = async (jid, media, quoted = '', options = {}) => {
        const resolved = await func.getFile(media, false, options)
        const source = Buffer.isBuffer(resolved?.data) ? resolved.data : Buffer.from(resolved?.data || media || '')
        const detected = await fileTypeFromBuffer(source)
        const mime = String(options.mimetype || resolved?.mime || detected?.mime || '').toLowerCase()
        let sticker = source

        if (mime === 'image/webp') {
            sticker = source
        } else if (mime.startsWith('image/')) {
            sticker = await imageToWebp(source)
        } else if (mime.startsWith('video/')) {
            sticker = await videoToWebp(source)
        } else {
            throw new Error('Sticker hanya mendukung media image, video, atau WebP.')
        }

        return sock.sendMedia(jid, sticker, quoted, {
            ...options,
            asSticker: true,
            mimetype: 'image/webp',
            fileName: options.fileName || 'sticker.webp',
        })
    }

    /* get name */
    sock.getName = jid => {
        let id = jidNormalizedUser(jid)
        if (id.endsWith("g.us")) {
            let metadata = db.data.groupMetadata?.[id]
            return metadata ? metadata.subject : "none"
        } else {
            let metadata = db.data.contacts[id]
            return (
                metadata?.name ||
                metadata?.verifiedName ||
                metadata?.notify ||
                parsePhoneNumber("+" + id.split("@")[0])
            )
        }
    }

    /* download media */
    sock.downloadMediaMessage = async (message, filename) => {
        const sourceCandidates = []
        const addCandidate = (candidate) => {
            if (!candidate || typeof candidate !== 'object' || sourceCandidates.includes(candidate)) return
            sourceCandidates.push(candidate)
            for (const key of [
                'message',
                'ephemeralMessage',
                'viewOnceMessage',
                'viewOnceMessageV2',
                'viewOnceMessageV2Extension',
                'documentWithCaptionMessage',
            ]) {
                addCandidate(candidate[key])
            }
        }
        addCandidate(message?.raw ?? message)
        addCandidate(message?.message)
        addCandidate(message?.msg)

        let buffer
        let lastError
        for (const source of sourceCandidates) {
            try {
                buffer = Buffer.from(await sock.message.downloadBytes(source))
                break
            } catch (error) {
                lastError = error
                if (!/no downloadable media/i.test(String(error?.message || error))) throw error
            }
        }
        if (!buffer) throw lastError || new Error('Message has no downloadable media')

        if (filename) {
            const mime = await fileTypeFromBuffer(buffer)
            const filePath = path.join(process.cwd(), `temp/${filename}.${mime?.ext || 'bin'}`)
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
            await fs.promises.writeFile(filePath, buffer)
            return filePath
        }

        return buffer
    }

    sock.downloadToFile = async (message, filePath) => {
        const source = message?.raw ?? message?.message ?? message?.msg ?? message
        return sock.message.downloadToFile(source, filePath)
    }

    /* parse tag */
    sock.parseMention = text => {
        if (typeof text === "string") {
            const matches = text.match(/@([0-9]{5,16}|0)/g) || []
            return matches.map(
                match => match.replace("@", "") + "@s.whatsapp.net"
            )
        }
    }

    /* decode jid */
    sock.decodeJid = jid => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {}
            return (
                (decode.user &&
                    decode.server &&
                    `${decode.user}@${decode.server}`) ||
                jid
            )
        } else return jid
    }
    return sock
}

function extractTextFromContent(content, seen = new Set()) {
    if (!content || typeof content !== 'object') {
        return typeof content === 'string' ? content.trim() : ''
    }
    if (seen.has(content)) return ''
    seen.add(content)

    const directFields = [
        'text', 'caption', 'conversation', 'contentText', 'selectedButtonId', 'selectedRowId',
        'selectedId', 'selectedDisplayText', 'body', 'title', 'name', 'description', 'url', 'mediaCaption'
    ]

    for (const field of directFields) {
        const value = content[field]
        if (typeof value === 'string' && value.trim()) return value.trim()
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
            return String(value).trim()
        }
    }

    for (const key of Object.keys(content)) {
        const value = content[key]
        const shouldDig = key === 'message' || key === 'extendedTextMessage' || key === 'imageMessage' || key === 'videoMessage'
            || key === 'audioMessage' || key === 'documentMessage' || key === 'stickerMessage' || key === 'quotedMessage'
            || key === 'conversation' || key === 'contextInfo' || key === 'interactiveResponseMessage' || key === 'templateMessage'
            || key === 'buttonsMessage' || key === 'listResponseMessage' || key === 'liveLocationMessage' || key === 'viewOnceMessage'
            || key === 'viewOnceMessageV2' || key === 'viewOnceMessageV2Extension' || key === 'protocolMessage'
        if (!shouldDig) continue
        const nested = extractTextFromContent(value, seen)
        if (nested) return nested
    }

    if (Array.isArray(content)) {
        for (const item of content) {
            const nested = extractTextFromContent(item, seen)
            if (nested) return nested
        }
    }

    return ''
}

export async function msg(sock, msg, db) {
    const m = {}
    let ids
    if (!msg || !msg.message) return msg

    if (msg.message.interactiveResponseMessage) {
        ids = JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id
    }

    m.raw = msg
    //let M = proto.WebMessageInfo
    m.message = parseMessage(msg.message)

    if (msg.key) {
        m.key = msg.key
        const remoteJid = m.key.remoteJidAlt || m.key.remoteJid || ''
        const participant = m.key.participantAlt || m.key.participant || msg.participant
        m.from = remoteJid.startsWith('status') ? jidNormalizedUser(participant) : jidNormalizedUser(remoteJid)
        m.chat = m.from
        m.chatJid = m.from
        m.fromMe = m.key.fromMe
        m.id = m.key.id
        m.device = /^3A/.test(m.id) ? 'ios' : m.id.startsWith('3EB') ? 'web' : /^.{21}/.test(m.id) ? 'android' : /^.{18}/.test(m.id) ? 'desktop' : 'unknown'
        m.isBot = m.id.startsWith('BAE5') || m.id.startsWith('HSK')
        m.isGroup = m.from.endsWith('@g.us')
        m.participant = normalizeOptionalJid(participant)
        m.senderJid = m.participant || m.from
        const senderIdentity = m.fromMe ? sock.user.id : m.isGroup ? m.participant : m.from
        m.sender = await resolveDatabaseJid(sock, senderIdentity)
        if (m.isGroup && m.participant) m.senderJid = await resolveDatabaseJid(sock, m.participant)
        if (!m.isGroup) m.from = await resolveDatabaseJid(sock, m.from)
        m.chat = m.from
        m.chatJid = m.from
    }

    if (m.isGroup) {
        const groupMetadata = db?.data?.groupMetadata?.[m.from]
            ? db.data.groupMetadata[m.from]
            : await sock.groupMetadata(m.from)
        const adminList = Array.isArray(groupMetadata.participants)
            ? groupMetadata.participants.filter(
                member => member.admin || member.superadmin
            )
            : Object.values(groupMetadata.participants).filter(
                member => member.admin || member.superadmin
            )
        m.isAdmin = !!adminList.find(member => member.id === m.sender)
        m.isBotAdmin = !!adminList.find(
            member => member.id === jidNormalizedUser(sock.user.id)
        )
    }

    m.pushName = msg.pushName
    m.isOwner = m.sender && db?.data?.setting?.owner.map(v => jidNormalizedUser(v)).includes(m.sender)
    if (m.message) {
        const messagePayload = m.message && typeof m.message === 'object' && !Array.isArray(m.message) && hasStructuredPayload(m.message)
            ? m.message
            : (m.message && typeof m.message === 'object' && !Array.isArray(m.message) ? m.message[getContentType(m.message)] : m.message)

        m.type = getMessageKind(m.message)
        m.msg = parseMessage(messagePayload) || messagePayload
        m.mentions = [...(m.msg?.contextInfo?.mentionedJid || []), ...(m.msg?.contextInfo?.groupMentions?.map(v => v.groupJid) || [])]
        const extractedBody = extractTextFromContent(m.message) || extractTextFromContent(m.msg) || ids || ''
        m.body = extractedBody || m.msg?.text ||
            m.msg?.conversation ||
            m.msg?.caption ||
            m.message?.conversation ||
            m.msg?.selectedButtonId ||
            m.msg?.singleSelectReply?.selectedRowId ||
            m.msg?.selectedId ||
            m.msg?.contentText ||
            m.msg?.selectedDisplayText ||
            m.msg?.title ||
            m.msg?.name || ids || ""
        m.prefix = new RegExp('^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]', 'gi').test(m.body) ? m.body.match(new RegExp('^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]', 'gi'))[0] : ''
        m.command = m.body && m.body.trim().replace(m.prefix, '').trim().split(/ +/).shift()
        m.args =
            m.body
                .trim()
                .replace(new RegExp('^' + escapeRegExp(m.prefix), 'i'), '')
                .replace(m.command, '')
                .split(/ +/)
                .filter(a => a) || []
        m.text = m.args.join(' ').trim()
        m.text = m.body
        m.isType = kind => m.type === kind
        m.mimetype = m.msg?.mimetype
        m.seconds = m.msg?.seconds
        m.expiration = m.msg?.contextInfo?.expiration || 0
        m.timestamps = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : (m.msg?.timestampMs || 0) * 1000
        m.isMedia = !!m.msg?.mimetype || !!m.msg?.thumbnailDirectPath

        m.isQuoted = false
        if (m.msg?.contextInfo?.quotedMessage) {
            m.isQuoted = true
            m.quoted = {}
            const quotedMessage = m.msg.contextInfo.quotedMessage
            const quotedMessagePayload = quotedMessage && typeof quotedMessage === 'object' && !Array.isArray(quotedMessage) && hasStructuredPayload(quotedMessage)
                ? quotedMessage
                : (quotedMessage && typeof quotedMessage === 'object' && !Array.isArray(quotedMessage)
                    ? quotedMessage[getContentType(quotedMessage)]
                    : quotedMessage)

            m.quoted.raw = quotedMessage
            m.quoted.message = parseMessage(quotedMessagePayload) || quotedMessagePayload

            if (m.quoted.message) {
                m.quoted.type = getContentType(m.quoted.message) || Object.keys(m.quoted.message)[0]
                const quotedNestedMessage = m.quoted.message && typeof m.quoted.message === 'object' && !Array.isArray(m.quoted.message) && hasStructuredPayload(m.quoted.message)
                    ? m.quoted.message
                    : (m.quoted.message && typeof m.quoted.message === 'object' && !Array.isArray(m.quoted.message) ? m.quoted.message[getContentType(m.quoted.message)] : m.quoted.message)
                m.quoted.msg = parseMessage(quotedNestedMessage) || quotedNestedMessage
                m.quoted.isMedia = !!m.quoted.msg?.mimetype || !!m.quoted.msg?.thumbnailDirectPath
                m.quoted.key = {
                    remoteJid: m.msg?.contextInfo?.remoteJid || m.from,
                    participant: normalizeOptionalJid(m.msg?.contextInfo?.participant),
                    fromMe: areJidsSameUser(jidNormalizedUser(m.msg?.contextInfo?.participant), jidNormalizedUser(sock?.user?.id)),
                    id: m.msg?.contextInfo?.stanzaId,
                }
                m.quoted.from = /g\.us|status/.test(m.msg?.contextInfo?.remoteJid) ? m.quoted.key.participant : m.quoted.key.remoteJid
                m.quoted.chat = m.quoted.from
                m.quoted.fromMe = m.quoted.key.fromMe
                m.quoted.id = m.msg?.contextInfo?.stanzaId
                m.quoted.device = /^3A/.test(m.quoted.id) ? 'ios' : /^3E/.test(m.quoted.id) ? 'web' : /^.{21}/.test(m.quoted.id) ? 'android' : /^.{18}/.test(m.quoted.id) ? 'desktop' : 'unknown'
                m.quoted.isBot = m.quoted.id.startsWith('BAE5') || m.quoted.id.startsWith('HSK')
                m.quoted.isGroup = m.quoted.from.endsWith('@g.us')
                m.quoted.participant = normalizeOptionalJid(m.msg?.contextInfo?.participant)
                m.quoted.sender = jidNormalizedUser(m.msg?.contextInfo?.participant || m.quoted.from)
                m.quoted.mentions = [...(m.quoted.msg?.contextInfo?.mentionedJid || []), ...(m.quoted.msg?.contextInfo?.groupMentions?.map(v => v.groupJid) || [])]
                m.quoted.body = extractTextFromContent(m.quoted.message) || extractTextFromContent(m.quoted.msg) || m.quoted.msg?.text || m.quoted.msg?.caption || m.quoted?.message?.conversation || m.quoted.msg?.selectedButtonId || m.quoted.msg?.singleSelectReply?.selectedRowId || m.quoted.msg?.selectedId || m.quoted.msg?.contentText || m.quoted.msg?.selectedDisplayText || m.quoted.msg?.title || m.quoted?.msg?.name || ''
                m.quoted.prefix = new RegExp('^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]', 'gi').test(m.quoted.body) ? m.quoted.body.match(new RegExp('^[°•π÷×¶∆£¢€¥®™+✓=|/~!?@#%^&.©^]', 'gi'))[0] : ''
                m.quoted.command = m.quoted.body && m.quoted.body.replace(m.quoted.prefix, '').trim().split(/ +/).shift()
                m.quoted.args =
                    m.quoted.body
                        .trim()
                        .replace(new RegExp('^' + escapeRegExp(m.quoted.prefix), 'i'), '')
                        .replace(m.quoted.command, '')
                        .split(/ +/)
                        .filter(a => a) || []
                m.quoted.text = m.quoted.args.join(' ').trim() || m.quoted.body
                m.quoted.isOwner = m.quoted.sender && db?.data?.setting?.owner.map(v => v.replace(/[^0-9]/g, '') + "@s.whatsapp.net").includes(m.quoted.sender)

                m.quoted.delete = async () => {
                    return await sock.message.send(m.from, {
                        type: 'revoke',
                        target: { key: m.quoted.key }
                    })
                }

                m.quoted.react = async react => {
                    return await sock.message.send(m.from, {
                        type: 'reaction',
                        emoji: String(react || ''),
                        target: { key: m.quoted.key }
                    })
                }

                m.quoted.download = async act => {
                    const payloadSource = m.quoted?.raw || m.quoted?.message || m.quoted?.msg || m.raw?.message || m
                    if (act) {
                        return await sock.downloadMediaMessage(payloadSource, rand(7))
                    } else {
                        return await sock.downloadMediaMessage(payloadSource)
                    }
                }


            }
        }
    }

    m.reply = async (text, trs, options = {}) => {
        const normalized = typeof text === "string" && trs ? await func.tr(text, db.data.setting.lang) : text
        const isBinary = Buffer.isBuffer(normalized) || normalized instanceof Uint8Array || normalized instanceof ArrayBuffer
        if (isBinary) {
            const media = Buffer.from(normalized)
            const detected = await fileTypeFromBuffer(media)
            const detectedMime = String(detected?.mime || '').toLowerCase()
            const isMedia = /^(image|video|audio)\//.test(detectedMime) || detectedMime === 'image/webp'
            if (isMedia && typeof sock.sendMedia === 'function') {
                return await sock.sendMedia(m.from, media, m.raw, {
                    ...options,
                    mimetype: options.mimetype || detectedMime,
                    fileName: options.fileName || `output.${detected?.ext || 'bin'}`,
                })
            }
            return await sock.message.send(
                m.from,
                {
                    type: 'document',
                    media,
                    mimetype: 'text/plain',
                    fileName: options.fileName || 'output.txt',
                    caption: options.caption,
                },
                {
                    quote: m.raw,
                    expirationSeconds: m.expiration || options.expirationSeconds,
                    id: rand(32),
                    ...options,
                }
            )
        }
        let safeText = normalized == null
            ? ''
            : typeof normalized === 'string'
                ? normalized
                : typeof normalized === 'number' || typeof normalized === 'boolean' || typeof normalized === 'bigint'
                    ? String(normalized)
                    : normalized instanceof Error
                        ? normalized.message || String(normalized)
                        : typeof normalized === 'object' && 'text' in normalized && normalized.text != null
                            ? String(normalized.text)
                            : String(normalized)

        if (typeof safeText !== 'string') safeText = String(safeText ?? '')
        if (safeText === 'undefined' || safeText === 'null') safeText = ''

        if (safeText.length > 4096) {
            return await sock.message.send(
                m.from,
                {
                    type: 'document',
                    media: Buffer.from(safeText, 'utf8'),
                    mimetype: 'text/plain',
                    fileName: options.fileName || 'output.txt',
                    caption: options.caption,
                },
                {
                    quote: m.raw,
                    expirationSeconds: m.expiration || options.expirationSeconds,
                    id: rand(32),
                    ...options,
                }
            )
        }

        return await sock.message.send(
            m.from,
            safeText,
            {
                quote: m.raw,
                expirationSeconds: m.expiration || options.expirationSeconds,
                id: rand(32),
                ...options,
            }
        )
    }

    m.delete = async () => {
        return await sock.message.send(m.from, {
            type: 'revoke',
            target: { key: m.quoted ? m.quoted.key : m.key }
        })
    }

    m.react = async react => {
        return await sock.message.send(m.from, {
            type: 'reaction',
            emoji: String(react || ''),
            target: { key: m.key }
        })
    }

    m.download = async act => {
        const payloadSource = m.raw?.message || m.quoted?.raw || m.quoted?.message || m.quoted?.msg || m.quoted || m
        if (act) {
            return await sock.downloadMediaMessage(payloadSource, rand(7))
        } else {
            return await sock.downloadMediaMessage(payloadSource)
        }
    }

    return m
}

function getContentType(content) {
    if (content) {
        const keys = Object.keys(content)
        const key = keys.find(k => (k === 'conversation' || k.endsWith('Message') || k.includes('V2') || k.includes('V3')) && k !== 'senderKeyDistributionMessage')
        if (key) return key
        if (typeof content.mimetype === 'string') {
            const mime = String(content.mimetype).toLowerCase()
            if (/image/.test(mime)) return 'imageMessage'
            if (/video/.test(mime)) return 'videoMessage'
            if (/audio/.test(mime)) return 'audioMessage'
            if (/application|text/.test(mime)) return 'documentMessage'
        }
        if (content.thumbnailDirectPath) return 'imageMessage'
    }
}

function getMessageKind(content) {
    const type = getContentType(content)
    if (!type) return 'unknown'
    if (type === 'conversation' || type === 'extendedTextMessage') return 'text'
    if (type === 'imageMessage') return 'image'
    if (type === 'videoMessage') return content?.videoMessage?.gifPlayback ? 'gif' : 'video'
    if (type === 'audioMessage') return content?.audioMessage?.ptt ? 'ptt' : 'audio'
    if (type === 'documentMessage' || type === 'documentWithCaptionMessage') return 'document'
    if (type === 'stickerMessage') return 'sticker'
    if (type === 'pollCreationMessage' || type === 'pollCreationMessageV2' || type === 'pollCreationMessageV3') return 'poll'
    if (type === 'locationMessage' || type === 'liveLocationMessage') return 'location'
    if (type === 'contactMessage' || type === 'contactsArrayMessage') return 'contact'
    if (type === 'reactionMessage') return 'reaction'
    return 'unknown'
}

function extractMessageContent(content) {
    if (!content || typeof content !== 'object') return content

    if (content.message) return extractMessageContent(content.message)
    if (content.extendedTextMessage) return extractMessageContent(content.extendedTextMessage)
    if (content.imageMessage) return extractMessageContent(content.imageMessage)
    if (content.videoMessage) return extractMessageContent(content.videoMessage)
    if (content.audioMessage) return extractMessageContent(content.audioMessage)
    if (content.documentMessage) return extractMessageContent(content.documentMessage)
    if (content.stickerMessage) return extractMessageContent(content.stickerMessage)
    if (content.locationMessage) return extractMessageContent(content.locationMessage)
    if (content.contactMessage) return extractMessageContent(content.contactMessage)
    if (content.templateMessage) return extractMessageContent(content.templateMessage)
    if (content.buttonsMessage) return extractMessageContent(content.buttonsMessage)
    if (content.listResponseMessage) return extractMessageContent(content.listResponseMessage)
    if (content.interactiveResponseMessage) return extractMessageContent(content.interactiveResponseMessage)
    if (content.viewOnceMessage) return extractMessageContent(content.viewOnceMessage)
    if (content.viewOnceMessageV2) return extractMessageContent(content.viewOnceMessageV2)
    if (content.viewOnceMessageV2Extension) return extractMessageContent(content.viewOnceMessageV2Extension)
    if (content.protocolMessage) return extractMessageContent(content.protocolMessage)
    if (content.reactionMessage) return extractMessageContent(content.reactionMessage)
    if (content.deletedMessage) return extractMessageContent(content.deletedMessage)

    const keys = Object.keys(content)
    for (const key of keys) {
        if (key === 'senderKeyDistributionMessage') continue
        if (key === 'messageContextInfo') continue
        const value = content[key]
        if (value && typeof value === 'object' && (key.endsWith('Message') || key.endsWith('MessageInfo') || key.includes('V2') || key.includes('V3'))) {
            return extractMessageContent(value)
        }
    }

    return content
}

function hasStructuredPayload(content) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return false
    const keys = Object.keys(content)
    if (!keys.length) return false
    const messageFields = ['text', 'caption', 'conversation', 'contentText', 'selectedButtonId', 'selectedRowId', 'selectedId', 'selectedDisplayText', 'body', 'title', 'name', 'mimetype', 'mediaType', 'thumbnailDirectPath']
    const hasDataField = keys.some(key => messageFields.includes(key))
    const hasContextInfo = Object.prototype.hasOwnProperty.call(content, 'contextInfo')
    const hasMediaShape = typeof content.mimetype === 'string' || typeof content.mediaType === 'string' || !!content.thumbnailDirectPath || !!content.jpegThumbnail || !!content.webpThumbnail
    return hasDataField && (hasContextInfo || hasMediaShape || keys.some(key => key.endsWith('Message') || key.includes('Message')))
}

function parseMessage(content) {
    content = extractMessageContent(content)

    if (content && typeof content === 'object' && !Array.isArray(content) && hasStructuredPayload(content)) {
        return content
    }

    if (content && content.viewOnceMessageV2Extension) {
        content = content.viewOnceMessageV2Extension.message
    }
    if (content && content.protocolMessage && content.protocolMessage.type == 14) {
        let type = getContentType(content.protocolMessage)
        content = content.protocolMessage[type]
    }
    if (content && content.message) {
        let type = getContentType(content.message)
        content = content.message[type]
    }

    return content
}
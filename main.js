console.log("Memulai...")
import pino from "pino"
import fs from "node:fs"
import { Boom } from "@hapi/boom"
import * as baileys from "baileys"
import readline from "readline"
import path from "path"
import axios from "axios"
import QRCode from 'qrcode'
import util from "util"
import { pathToFileURL } from "url"
import { createRequire } from "module"
const require = createRequire(import.meta.url)

const { Client, msg } = await import(`./lib/serialize.js?${Date.now()}`)
import { JSONFilePreset } from 'lowdb/node'
import color from "./lib/color.js"
import setting from "./config.js"
import sch from "./lib/schema.js"
import * as func from "./lib/function.js"
const { default: CommandHandler } = await import(`./handler.js?${Date.now()}`)
const logger = pino({ timestamp: () => `,"time":"${new Date().toJSON()}"` })
logger.level = 'fatal'

let { state, saveCreds } = await baileys.useMultiFileAuthState("./session");


const defaultData = {
    users: {},
    groups: {},
    setting: {
        number: null,
        owner: setting.owner,
        noPrefix: setting.noPrefix,
    },
    contacts: {},
    groupMetadata: {}
    }
let db = await JSONFilePreset('db.json', defaultData)

let phone = db?.data?.setting?.number
const handler = new CommandHandler()

const processDirectory = async (currentDir) => {
    try {
        const items = fs.readdirSync(currentDir)
        for (const item of items) {
            const fullPath = path.join(currentDir, item)
            const stat = fs.statSync(fullPath)

            if (stat.isDirectory()) {
                await processDirectory(fullPath)
                watchDirectory(fullPath)
            } else if (item.endsWith('.js') || item.endsWith('.cjs') || item.endsWith('.mjs')) {
                await handler.loadPlugin(fullPath)
            }
        }
    } catch (error) {
        console.error("[ERROR] Error processing directory:", currentDir, error)
    }
}

const loadCommands = async (dir) => {
    handler.clear()
    await processDirectory(dir)
}

const cmdDir = path.join(process.cwd(), 'plugins')
await loadCommands(cmdDir)

let debounceTimeout
const debounceDelay = 100

function watchDirectory(dirPath) {
    fs.watch(dirPath, (eventType, filename) => {
        if (!filename) return

        const filePath = path.join(dirPath, filename)

        clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(async () => {
            try {
                const stats = await fs.promises.stat(filePath)
                const isSupportedFile = ['.js', '.cjs', '.mjs'].some(ext => filename.endsWith(ext))

                if (stats.isFile() && isSupportedFile) {
                    console.log(color.cyan(`[INFO] File updated: ${filename}`))
                    await handler.loadPlugin(filePath)
                } else if (stats.isDirectory()) {
                    console.log(color.green(`[INFO] Directory added: ${filename}`))
                    await processDirectory(filePath)
                    watchDirectory(filePath)
                }
            } catch (err) {
                if (err.code === 'ENOENT') {
                    console.log(color.red(`[INFO] File or directory removed: ${filename}`))
                    handler.clear()
                    await loadCommands(cmdDir)
                } else {
                    console.error(`[ERROR] Could not access ${filePath}:`, err)
                }
            }
        }, debounceDelay)
    })

    fs.readdirSync(dirPath).forEach((item) => {
        const fullPath = path.join(dirPath, item)
        if (fs.statSync(fullPath).isDirectory()) {
            watchDirectory(fullPath)
        }
    })
}

watchDirectory(cmdDir)
async function connectWA() {
    process.on("uncaughtException", error => {
        console.error("Uncaught Exception:", error.message)
    })
    async function getPhoneNumber() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })

        return new Promise((resolve) => {
            rl.question('[+] WhatsApp: ', async (number) => {
                db.data.setting.number = number.replace(/[^0-9]/g, '')
                db.data.setting.owner = setting.owner
                db.write()
                rl.close()
                resolve(number.replace(/[^0-9]/g, ''))
            })
        })
    }
    console.log(color.yellow("[+] STARTING WHATSAPP BOT..."))
    const { version, isLatest } = await baileys.fetchLatestBaileysVersion()
    console.log(color.cyan(`[+] Using WA v${version.join(".")}, isLatest: ${isLatest}`))

    if (!phone) {
        phone = await getPhoneNumber()
    }

    console.log(color.cyan(`[+] Request Pairing: ${phone}`))

    const sock = Client(db, {
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: baileys.makeCacheableSignalKeyStore(state.keys, logger)
        },
        mobile: false,
//        printQRInTerminal: true,
        browser: baileys.Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        retryRequestDelayMs: 10,
        transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 10 },
        maxMsgRetryCount: 15,
        appStateMacVerification: {
            patch: true,
            snapshot: true
        },
    })

    if (!sock.authState.creds.registered && setting.usePairingCode) {
        setTimeout(async () => {
            const code = (await sock.requestPairingCode(phone))
                ?.match(/.{1,4}/g)
                ?.join("-") || ""
            console.log(`Your Pairing Code: `, color.green(code))
        }, 5000)
    }

    sock.ev.on("connection.update", async update => {
        const { lastDisconnect, connection, receivedPendingNotifications, qr } = update
        if (qr && !setting.usePairingCode) {
            console.log(await QRCode.toString(qr, {type:'terminal'}))
        }
        if (receivedPendingNotifications && !sock.authState.creds?.myAppStateKeyId) {
            sock.ev.flush()
        }
        if (connection) {
            console.log(color.yellow(`[+] Connection Status : ${connection}`))
        }
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode
            // console.log('reason: ', reason)
            //console.log('dis ', baileys.DisconnectReason)

            switch (reason) {
                case 408:
                    console.log(color.red('[+] Connection timed out. restarting...'))
                    await connectWA()
                    break
                case 503:
                    console.log(color.red('[+] Unavailable service. restarting...'))
                    await connectWA()
                    break
                case 428:
                    console.log(color.cyan('[+] Connection closed, restarting...'))
                    await connectWA()
                    break
                case 515:
                    console.log(color.cyan('[+] Need to restart, restarting...'))
                    await connectWA()
                    break

                case 401:
                    try {
                        console.log(color.cyan('[+] Session Logged Out.. Recreate session...'))
                        fs.rmSync('./session', { recursive: true, force: true })
                        console.log(color.green('[+] Session removed!!'))
                        process.send('reset')
                    } catch {
                        console.log(color.cyan('[+] Session not found!!'))
                    }
                    break

                case 403:
                    console.log(color.red(`[+] Your WhatsApp Has Been Baned :D`))
                    fs.rmSync('./session', { recursive: true, force: true })
                    process.send('reset')
                    break

                case 405:
                    try {
                        console.log(color.cyan('[+] Session Not Logged In.. Recreate session...'))
                        fs.rmSync('./session', { recursive: true, force: true })
                        console.log(color.green('[+] Session removed!!'))
                        process.send('reset')
                    } catch {
                        console.log(color.cyan('[+] Session not found!!'))
                    }
                    break
                default:

            }
        }
        if (connection === "open") {
            //const conn = await func.loads("amiruldev/conn.js")
            //conn(color, sock, axios)
            if (!fs.existsSync("./temp")) {
                fs.mkdirSync("./temp")
                console.log(color.cyan('[+] Folder "temp" successfully created.'))
            }
            //await mydb.write(db)
        }
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("messages.upsert", async ({ type, messages }) => {
        if (type === "notify" && messages.length) {
            let m = messages[0]
            if (m.message) {
                m.message = m.message?.ephemeralMessage
                    ? m.message.ephemeralMessage.message
                    : m.message
                const mes = await msg(sock, m, db)
                sch.schema(mes, sock, db)
                await handler.execute(mes, sock, db, func, color, util, messages)
            }
        }
    })

    sock.ev.on("contacts.update", update => {
        for (const contact of update) {
            const id = baileys.jidNormalizedUser(contact.id)
            if (db.data.contacts) {
                db.data.contacts[id] = {
                    ...(db.data.contacts[id] || {}),
                    ...(contact || {})
                }
            }
        }
    })

    sock.ev.on("contacts.upsert", update => {
        for (const contact of update) {
            const id = baileys.jidNormalizedUser(contact.id)
            if (db.data.contacts) {
                db.data.contacts[id] = { ...(contact || {}), isContact: true }
            }
        }
    })

    sock.ev.on("groups.update", updates => {
        for (const update of updates) {
            const id = update.id
            if (db.data.groupMetadata[id]) {
                console.log(color.green('[+] Group Metadata Updated!!'))
                db.data.groupMetadata[id] = {
                    ...(db.data.groupMetadata[id] || {}),
                    ...(update || {})
                }
            }
        }
    })

    sock.ev.on("group-participants.update", ({ id, participants, action }) => {
        const metadata = db.data.groupMetadata[id]
        if (metadata) {
            switch (action) {
                case "add":
                case "revoked_membership_requests":
                    metadata.participants.push(
                        ...participants.map(id => ({
                            id: baileys.jidNormalizedUser(id),
                            admin: null
                        }))
                    )
                    break
                case "demote":
                case "promote":
                    for (const participant of metadata.participants) {
                        const id = baileys.jidNormalizedUser(participant.id)
                        if (participants.includes(id)) {
                            console.log(`${color.green(`[ ${action} ]`)} ${id.split("@")[0]} in group ${color.cyan(metadata.subject)}`)
                            participant.admin =
                                action === "promote" ? "admin" : null
                        }
                    }
                    break
                case "remove":
                    metadata.participants = metadata.participants.filter(
                        p => !participants.includes(baileys.jidNormalizedUser(p.id))
                    )
                    break
            }
        }
    })

    // interval save db
    /*
    setInterval(async () => {
        await db.write(db)
    }, 3000)
    */
}

connectWA()
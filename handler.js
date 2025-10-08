/* module external */
import path from "path"
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
const require = createRequire(import.meta.url)
const isNumber = x => typeof x === 'number' && !isNaN(x)

/* module internal */
import color from './lib/color.js'

export default class CommandHandler {
    constructor() {
        this.commands = new Map()
        this.plugins = {}
        this.functions = new Set()
        this.prefixes = ['.', ',', '/', '\\', '#', '!']
        this.executedCommands = new Set()
    }

    addFunction(fn) {
        this.functions.add(fn)
    }

    async loadPlugin(filePath) {
        try {
            const resolvedPath = path.resolve(filePath)
            if (require.cache[resolvedPath]) {
                delete require.cache[resolvedPath]
            }
            let namePlugin = path.basename(filePath)
            let module
            const ext = path.extname(filePath)
            if (ext === '.cjs') {
                const require = createRequire(import.meta.url)
                module = require(filePath)
            } else if (ext === '.js' || ext === '.mjs') {
                const fileUrl = pathToFileURL(filePath).href + `?${Date.now()}`
                module = await import(fileUrl)
            } else {
                return false
            }
    
            const commandFunction = module.default || module
            if (typeof commandFunction === 'function') {
                this.plugins[namePlugin] = commandFunction
                return true
            }
            return false
        } catch (error) {
            console.error("[ERROR] Failed to load file:", filePath, error)
            return false
        }
    }
    async dfail(type, m, conn) {
        let msg = {
            owner: `*Only Owner can use this command!*`,
            group: `*This command can only be used in groups!*`,
            private: `*This command can only be used in private chat!*`,
            admin: `*Only Admins can use this command!*`,
            botAdmin: `*Bot must be an Admin to execute this command!*`,
            nsfw: `*NSFW feature is not activated in this group!*`,
            restrict: `*This command is restricted by the owner!*`,
            premium: `*Only Premium users can use this command!*`,
            unreg: `*You are not registered yet!*\n\nType .register to register.`,
        }[type]
        if (msg) return m.reply(msg)
    }

    async execute(m, sock, db, func, color, util, messages) {
        m.plugin = undefined
        try {
            if (this.executedCommands.has(m.id)) return false
            this.executedCommands.add(m.id)
            for (const fn of this.functions) {
                try {
                    await fn(m, { sock, db, color, func })
                } catch (error) {
                    console.error("[ERROR] Error in function handler:", error)
                }
            }

            if (!m.body) return false
            const text = m.body.trim()
            const gc = m.isGroup ? db.data.groups[m.from] : false
            const usr = db.data.users[m.sender] || {}
            const isPrems = m.isOwner || usr.premium || false
            // mute gc
            //if (m.isGroup && gc.mute && !m.isOwner) return false

            // self mode
            //if (db.data.setting.self && !m.isOwner && !m.key.fromMe) return false

            // autoread
            if (db.data.setting.autoread) {
                await sock.readMessages([m.key])
            }

            // readstory
            //const sw = await func.loads("amiruldev/sw.js")
            //await sw(sock, db, m)
            
            for (const pluginName in this.plugins) {
                const plugin = this.plugins[pluginName]
                if (!plugin) continue
                if (plugin.disabled) continue
                let fail = plugin.fail || this.dfail
                m.limit = false
                m.exp = 0
                m.plugin = pluginName
                if (typeof plugin.all === 'function') {
                    try {
                        await plugin.all.call(sock, m, { conn: sock, chatUpdate: messages, db, func, color, util })
                    } catch (error) {
                        console.error(`[ERROR] Error in plugin 'all' method (${pluginName}):`, error)
                    }
                }
                if (typeof plugin.before === 'function') {
                    if (await plugin.before.call(sock, m , {
                        conn: sock,
                        db,
                        func,
                        color,
                        util,
                        chatUpdate: messages,
                    })) continue
                }

                const usedPrefix = this.prefixes.find(p => text.startsWith(p))
                let noPrefix = text.replace(usedPrefix, '')
                let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
                args = args || []
                let _args = noPrefix.trim().split` `.slice(1)
                _args = _args || []
                let textMessage = _args.join` `
                command = (command || '').toLowerCase()
                let isAccept = plugin.command instanceof RegExp ?
                    plugin.command.test(command) :
                    Array.isArray(plugin.command) ?
                        plugin.command.some(cmd => cmd instanceof RegExp ? cmd.test(command) : cmd === command) :
                        typeof plugin.command === 'string' ?
                            plugin.command === command :
                            false
                if (!isAccept) continue
                if (plugin.owner && !m.isOwner) {
                    fail('owner', m, sock)
                    continue
                }
                if (plugin.group && !m.isGroup) {
                    fail('group', m, sock)
                    continue
                }
                if (plugin.private && m.isGroup) {
                    fail('private', m, sock)
                    continue
                }
                if (plugin.admin && m.isGroup && !m.isAdmin) {
                    fail('admin', m, sock)
                    continue
                }
                if (plugin.botAdmin && m.isGroup && !m.isBotAdmin) {
                    fail('botAdmin', m, sock)
                    continue
                }
                if (plugin.nsfw && m.isGroup && !gc.nsfw) {
                    fail('nsfw', m, sock)
                    continue
                }
                if (plugin.restrict && db.data.setting.restrict && !m.isOwner) {
                    fail('restrict', m, sock)
                    continue
                }
                if (plugin.premium && !isPrems) {
                    fail('premium', m, sock)
                    continue
                }
                if (plugin.registered && !usr.registered) {
                    fail('unreg', m, sock)
                    continue
                }
                m.isCommand = true
                let xp = 'exp' in plugin ? parseInt(plugin.exp) : 17
                if (xp > 200)
                    console.log("ngecit -_-")
                else
                    m.exp += xp
                if (!isPrems && plugin.limit && usr.limit < plugin.limit * 1) {
                    m.reply(`Your limit is not enough to use this command, need ${plugin.limit} limit`)
                    continue
                }
                let extra = {
                    conn: sock,
                    args,
                    db,
                    func,
                    color,
                    util,
                    chatUpdate: messages,
                    command,
                    text: textMessage,
                    usedPrefix,
                    isPrems,
                    isOwner: m.isOwner,
                    isAdmin: m.isAdmin,
                    isBotAdmin: m.isBotAdmin,
                }
                try {
                    await plugin.call(sock, m, extra)
                    if (!isPrems)
                        m.limit = m.limit || plugin.limit || false
                } catch (error) {
                    m.error = error
                    console.error(`[ERROR] Error in plugin command method (${pluginName}):`, error)
                } finally {
                    if (typeof plugin.after === 'function') {
                        try {
                            await plugin.after.call(sock, m, extra)
                        } catch (error) {
                            console.error(`[ERROR] Error in plugin 'after' method (${pluginName}):`, error)
                        }
                    }
                }
                if (m.limit) {
                    db.data.users[m.sender].limit -= m.limit * 1
                    m.reply(+m.limit + ' ʟɪᴍɪᴛ ᴋᴀᴍᴜ ᴛᴇʀᴘᴀᴋᴀɪ ✔️')
                }
                if (m.exp)
                    db.data.users[m.sender].exp += m.exp * 1
            }
        } catch (error) {
            console.error("[ERROR] Error in execute method:", error)
        } finally {
            db.data.stats ? db.data.stats = db.data.stats : db.data.stats = {}
            let stats = db.data.stats
            let stat
            if (m.plugin) {
            let now = +new Date
            if (m.plugin in stats) {
                stat = stats[m.plugin]
                if (!isNumber(stat.total))
                    stat.total = 1
                if (!isNumber(stat.success))
                    stat.success = m.error != null ? 0 : 1
                if (!isNumber(stat.last))
                    stat.last = now
                if (!isNumber(stat.lastSuccess))
                    stat.lastSuccess = m.error != null ? 0 : now
            } else
                stat = stats[m.plugin] = {
                    total: 1,
                    success: m.error != null ? 0 : 1,
                    last: now,
                    lastSuccess: m.error != null ? 0 : now
                }
            stat.total += 1
            stat.last = now                
            if (m.error == null) {
                stat.success += 1
                stat.lastSuccess = now
                }
            }
        }
        db.write()
    }
/*
    async handleCommand(text, prefix, m, sock, db, func, color, util, usr) {
        const [cmd, ...args] = text.slice(prefix.length).trim().split(' ')
        const command = this.commands.get(cmd.toLowerCase())

        if (command && !command.noPrefix) {
            const cmd = await func.loads('amiruldev/cmd.js')
            const mcmd = await cmd(command, usr, sock, m, db)
            if (mcmd) return;
            try {
                const parsedArgs = this.parseArguments(args, command.expectedArgs)
                await command.run(m, { sock, args: parsedArgs, db, util, color, func, cmds: this.commands })
                return true
            } catch (error) {
                console.error("[ERROR] Error executing prefixed command:", error)
            }
        }
        return false
    }

    async handleNoPrefixCommand(text, m, sock, db, func, color, util) {
        const [potentialCmd, ...args] = text.split(' ')
        const command = this.commands.get(potentialCmd.toLowerCase())
        const usr = db.data.users[m.sender] || {}

        if (command && command.noPrefix) {
            const cmd = await func.loads('amiruldev/cmd.js')
            const mcmd = await cmd(command, usr, sock, m, db)
            if (mcmd) return;
            try {
                const parsedArgs = this.parseArguments(args, command.expectedArgs)
                await command.run(m, { sock, args: parsedArgs, db, util, color, func, cmds: this.commands })
                return true
            } catch (error) {
                console.error("[ERROR] Error executing non-prefixed command:", error)
            }
        }
        return false
    }
*/
    parseArguments(args, expectedArgs) {
        const argObject = {}
        args.forEach(arg => {
            const [key, value] = arg.split('=')
            if (expectedArgs[key]) argObject[key] = value || true
        })
        return argObject
    }

    clear() {
        this.commands.clear()
        this.plugins = {}
        this.functions.clear()
        this.executedCommands.clear()
    }
}
const schema = async (m, sock, db) => {
    const isNumber = x => typeof x === 'number' && !Number.isNaN(x)
    const isBoolean = x => typeof x === 'boolean'

    db.data.users ??= {}
    db.data.groups ??= {}

    const user = db.ensureUser?.(m.sender, {
        name: m.pushName,
        lastChat: -1,
        ads: -1,
        lang: '',
        afk: -1,
        afk_reason: '',
        exp: 0,
        limit: 10,
        saldo: 0,
        point: 0,
        exp_prem: 0,
        premium: false,
        autoDownload: false,
        autoSticker: false,
        banned: false,
        logAi: [],
        total_trx: 0,
        jumlah_trx: 0,
        depo: {},
    }) || db.data.users[m.sender]

    if (!m.sender.endsWith('@s.whatsapp.net') && !m.sender.endsWith('@lid')) return
    user.name ??= m.pushName
    user.lastChat ??= -1
    user.ads ??= -1
    user.lang ??= ''
    if (!isNumber(user.afk)) user.afk = -1
    user.afk_reason ??= ''
    if (!isNumber(user.exp)) user.exp = 0
    if (!isNumber(user.limit)) user.limit = 10
    if (!isNumber(user.saldo)) user.saldo = 0
    if (!isNumber(user.point)) user.point = 0
    user.exp_prem ??= 0
    if (!isBoolean(user.premium)) user.premium = false
    if (!isBoolean(user.autoDownload)) user.autoDownload = false
    if (!isBoolean(user.autoSticker)) user.autoSticker = false
    if (!isBoolean(user.banned)) user.banned = false
    user.logAi ??= []
    user.total_trx ??= 0
    user.jumlah_trx ??= 0
    user.depo ??= {}

    if (m.isGroup) {
        const group = db.ensureGroup?.(m.from, {
            name: await sock.getName(m.from),
            lastChat: Date.now(),
            mute: false,
            antiLink: false,
            autoDownload: false,
            autoSticker: false,
            blacklist: [],
        }) || db.data.groups[m.from]

        if (!m.from.endsWith('@g.us')) return
        group.name ??= await sock.getName(m.from)
        if (!isNumber(group.lastChat)) group.lastChat = Date.now()
        if (!isBoolean(group.mute)) group.mute = false
        if (!isBoolean(group.antiLink)) group.antiLink = false
        if (!isBoolean(group.autoDownload)) group.autoDownload = false
        if (!isBoolean(group.autoSticker)) group.autoSticker = false
        group.blacklist ??= []

        db.data.groupMetadata[m.from] = db.data.groupMetadata?.[m.from] || await sock.groupMetadata(m.from)
    }

    db.data.setting ??= {}
    const setting = db.data.setting
    setting.firstchat ??= true
    setting.readstory ??= true
    setting.reactstory ??= false
    setting.autoread ??= false
    setting.self ??= false
    setting.selfOwner ??= Array.isArray(setting.owner) && setting.owner.length ? setting.owner[0] : ''
    setting.debug ??= false
    setting.resAi ??= []
    setting.number ??= ''
    setting.owner ??= db.data.setting.owner || []
    setting.ch_id ??= '120363181344949815@newsletter'
    setting.ch_name ??= '🔥 LightWeight WhatsApp Bot'
    setting.logo ??= 'https://i.pinimg.com/originals/74/59/1e/74591e80455fb1736b35313ed2f07148.jpg'
    setting.dev ??= 'Made by Abdul Haliq'
    setting.packname ??= 'Chitanda Bot'
    setting.ignoreJid ??= []
    setting.lang ??= 'id'
    setting.api ??= {}
    setting.limit ??= {
        free: 10,
        prem: 100,
        own: 9999,
        reset: '00:00',
    }
}

export default { schema }
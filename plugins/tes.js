let handler = async (m, { conn, usedPrefix, command, args, isOwner, isPrems, groupMetadata, chatUpdate, messages }) => {
    m.reply(`${usedPrefix + command} berhasil`)
}
handler.command = /^(tes)$/i

export default handler
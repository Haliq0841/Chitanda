import { Buffer } from 'buffer'
const str = `const handler = async (m, { conn, text, usedPrefix}) => {\n// isi fungsi kamu\n};\n\nhandler.help = ['donasi'];\nhandler.tags = ['info'];\nhandler.command = /^dona(te|si)$/i;\nexport default handler;`.trim()
 const encoded = Buffer.from(str).toString('base64')
 //console.log(str)

console.log(await import(`data:text/javascript;base64,${encoded}`))
import syntaxerror from 'syntax-error'
import { format } from 'util'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createRequire } from 'module'
import { runRestrictedEval } from '../../lib/eval-sandbox.js'
import { proto } from 'zapo-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(__dirname)

let handler = async (m, _2) => {
  let { conn, usedPrefix, noPrefix, args, groupMetadata, db, func, thisClass } = _2
  if (!m.isDev) {
    try {
      const simulation = await runRestrictedEval(noPrefix, {
        message: { ...m, db },
        args,
        text: args.join(' '),
        conn,
      })
      const output = simulation.output.length ? `\n${simulation.output.join('\n')}` : ''
      const result = simulation.result === undefined ? '' : `\n${format(simulation.result)}`
      await m.reply(`Hasil eval simulasi:${output}${result}`.slice(0, 4000))
    } catch (error) {
      await m.reply(`Eval simulasi ditolak: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }
  let _return
  let _syntax = ''
  const consoleOutput = []
  const evalConsole = Object.freeze({
    log: (...values) => {
      console.log(...values)
      consoleOutput.push(values.map((value) => format(value)).join(' '))
    },
    info: (...values) => {
      console.info(...values)
      consoleOutput.push(values.map((value) => format(value)).join(' '))
    },
    warn: (...values) => {
      console.warn(...values)
      consoleOutput.push(values.map((value) => format(value)).join(' '))
    },
    error: (...values) => {
      console.error(...values)
      consoleOutput.push(values.map((value) => format(value)).join(' '))
    },
  })
  let _text = (/^=>/.test(usedPrefix) ? 'return ' : '') + noPrefix
  let old = m.exp * 1
  try {
    let i = 15
    let f = {
      exports: {}
    }
    let exec = new (async () => { }).constructor('print', 'm', 'func', 'db','handler', 'require', 'proto', 'jid', 'conn', 'client', 'sock', 'Array', 'process', 'args', 'groupMetadata', 'module', 'exports', 'argument', 'thisClass', 'console', _text)
    _return = await exec.call(conn, (...args) => {
      if (--i < 1) return
      console.log(...args)
      return conn.reply(m.chat, format(...args), m)
    }, m, func, db, handler, require, proto, m.chat, conn, conn, conn, CustomArray, process, args, groupMetadata, f, f.exports, _2, thisClass, evalConsole)
  } catch (e) {
    let err = syntaxerror(_text, 'Execution Function', {
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
        sourceType: 'module'
    })
    if (err) _syntax = '```' + err + '```\n\n'
    _return = e
  } finally {
    const consoleText = consoleOutput.length ? `Console output:\n${consoleOutput.join('\n')}\n\n` : ''
    const resultText = _return === undefined ? '' : format(_return)
    const trainingoi = consoleText + _syntax + resultText
    if (trainingoi) await m.reply(trainingoi)
    m.exp = old
  }
}
handler.help = ['> ', '=> ']
handler.tags = ['advanced']
handler.customPrefix = ['=>' , '>']
handler.command = /(?:)/i

handler.owner = true

export default handler

class CustomArray extends Array {
  constructor(...args) {
    if (typeof args[0] == 'number') return super(Math.min(args[0], 10000))
    else return super(...args)
  }
}

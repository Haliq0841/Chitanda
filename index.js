import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entryPoint = join(__dirname, 'main.js')

let childProcess = null
let restarting = false

function startBot() {
  if (childProcess && !childProcess.killed) {
    return
  }

  childProcess = spawn(process.execPath, [entryPoint, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  })

  childProcess.on('exit', (code, signal) => {
    if (restarting) {
      return
    }

    if (code === 0) {
      console.log('[INFO] Bot process exited cleanly.')
      return
    }

    console.log(`[INFO] Bot crashed with code ${code ?? signal ?? 'unknown'}, restarting...`)
    startBot()
  })

  childProcess.on('message', (message) => {
    if (message === 'reset') {
      restarting = true
      childProcess.kill('SIGTERM')
      restarting = false
      startBot()
    }
  })
}

console.log('🐾 Starting bot manager...')
startBot()


import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execCallback)
const gitOptions = {
  cwd: process.cwd(),
  timeout: 120000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
}

const handler = async (m) => {
  const status = await m.reply('Menyamakan file tracked dengan GitHub. Perubahan lokal pada file tersebut akan ditimpa...')

  try {
    await exec('git fetch origin +refs/heads/main:refs/remotes/origin/main', gitOptions)
    const { stdout, stderr } = await exec('git reset --hard refs/remotes/origin/main', gitOptions)
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    const result = output || 'File tracked sudah sama dengan origin/main.'
    await status.edit(`Update selesai. Perubahan lokal pada file tracked sudah ditimpa. Restart bot agar semua perubahan aktif.\n\n${result}`.slice(0, 4000))
  } catch (error) {
    const detail = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').trim()
    await status.edit(`Update gagal.\n\n${detail}`.slice(0, 4000))
  }
}

handler.help = ['update']
handler.tags = ['owner']
handler.command = /^updatescript|update-script|updatesc$/i
handler.owner = true
handler.dev = true

export default handler
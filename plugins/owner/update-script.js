import { exec as execCallback } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import unzipper from 'unzipper'

const exec = promisify(execCallback)
const repository = 'https://github.com/Haliq0841/Chitanda.git'
const sourceRef = 'refs/remotes/chitanda/main'
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const gitOptions = {
  cwd: projectRoot,
  timeout: 120000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
}

const isRuntimeData = (relativePath) => {
  const segments = relativePath.split('/')
  const fileName = segments.at(-1)
  return segments.some((segment) => ['.auth', '.git', 'models', 'node_modules', 'session', 'temp'].includes(segment))
    || fileName === 'config.js'
    || fileName === 'db.json'
    || /^db\.sqlite(?:-(?:shm|wal))?$/.test(fileName)
    || /^\.env(?:\.|$)/.test(fileName)
}

const updateFromArchive = async () => {
  const response = await fetch('https://codeload.github.com/Haliq0841/Chitanda/zip/refs/heads/main')
  if (!response.ok) throw new Error(`Unduhan GitHub gagal: HTTP ${response.status}`)

  const archive = await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()))
  const files = archive.files.filter((entry) => !entry.type)
  let updatedFiles = 0

  for (const entry of files) {
    const archivePath = entry.path.replaceAll('\\', '/')
    const rootSeparator = archivePath.indexOf('/')
    if (rootSeparator < 1) continue

    const relativePath = archivePath.slice(rootSeparator + 1)
    if (!relativePath || relativePath.split('/').includes('..') || path.posix.isAbsolute(relativePath) || isRuntimeData(relativePath)) continue

    const destination = path.resolve(projectRoot, ...relativePath.split('/'))
    const destinationRelative = path.relative(projectRoot, destination)
    if (destinationRelative.startsWith('..') || path.isAbsolute(destinationRelative)) {
      throw new Error(`Path arsip di luar folder aplikasi: ${entry.path}`)
    }

    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, await entry.buffer())
    updatedFiles += 1
  }

  if (updatedFiles === 0) throw new Error('Arsip GitHub tidak berisi file yang dapat diperbarui.')
  return updatedFiles
}

const handler = async (m) => {
  const status = await m.reply('Menyamakan file tracked dengan GitHub. Perubahan lokal pada file tersebut akan ditimpa...')

  try {
    await exec(`git fetch ${repository} +refs/heads/main:${sourceRef}`, gitOptions)
    const { stdout, stderr } = await exec(`git reset --hard ${sourceRef}`, gitOptions)
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    const result = output || 'File tracked sudah sama dengan main di GitHub.'
    await status.edit(`Update selesai. Perubahan lokal pada file tracked sudah ditimpa. Restart bot agar semua perubahan aktif.\n\n${result}`.slice(0, 4000))
  } catch (gitError) {
    try {
      const updatedFiles = await updateFromArchive()
      await status.edit(`Git gagal, jadi file diperbarui langsung dari arsip GitHub (${updatedFiles} file). Config dan data runtime lokal dipertahankan. Restart bot agar semua perubahan aktif.`)
    } catch (archiveError) {
      const gitDetail = [gitError.stdout, gitError.stderr, gitError.message].filter(Boolean).join('\n').trim()
      const archiveDetail = [archiveError.message].filter(Boolean).join('\n').trim()
      await status.edit(`Update gagal melalui Git maupun arsip GitHub.\n\nGit:\n${gitDetail}\n\nArsip:\n${archiveDetail}`.slice(0, 4000))
    }
  }
}

handler.help = ['update']
handler.tags = ['owner']
handler.command = /^updatescript|update-script|updatesc$/i
handler.owner = true
handler.dev = true

export default handler
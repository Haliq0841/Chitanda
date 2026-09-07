import fs from 'node:fs'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Open } = require('unzipper')

const rootDir = process.cwd()
const backupDir = path.join(rootDir, 'temp')
const databaseFiles = ['db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm']
const authFiles = ['.auth/state.sqlite', '.auth/state.sqlite-wal', '.auth/state.sqlite-shm']
const restoreRoots = ['db.sqlite', '.auth/', 'session/']

const existingFiles = (relativePaths) => relativePaths
  .map((relativePath) => ({ relativePath, absolutePath: path.join(rootDir, relativePath) }))
  .filter(({ absolutePath }) => fs.existsSync(absolutePath))

const addDirectory = (archive, relativePath) => {
  const absolutePath = path.join(rootDir, relativePath)
  if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
    archive.directory(absolutePath, relativePath)
    return true
  }
  return false
}

const createBackup = async (outputPath) => {
  const output = fs.createWriteStream(outputPath)
  const archive = new ZipArchive({ zlib: { level: 9 } })

  return new Promise((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)

    for (const file of existingFiles([...databaseFiles, ...authFiles])) {
      archive.file(file.absolutePath, { name: file.relativePath })
    }

    addDirectory(archive, 'session')
    archive.finalize().catch(reject)
  })
}

const isAllowedRestorePath = (entryPath) => {
  const normalized = entryPath.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized || normalized.includes('\0') || path.posix.isAbsolute(normalized)) return false
  if (normalized.split('/').includes('..')) return false
  return restoreRoots.some((root) => normalized === root || normalized.startsWith(root))
}

const restoreBackup = async (archivePath) => {
  const archive = await Open.file(archivePath)
  const files = archive.files.filter((entry) => !entry.type && isAllowedRestorePath(entry.path))
  if (!files.length) throw new Error('Arsip tidak berisi file database atau session yang valid.')

  for (const entry of files) {
    const relativePath = entry.path.replaceAll('\\', '/')
    const targetPath = path.resolve(rootDir, relativePath)
    if (!targetPath.startsWith(`${rootDir}${path.sep}`) && targetPath !== rootDir) {
      throw new Error(`Path restore tidak valid: ${relativePath}`)
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.promises.writeFile(targetPath, await entry.buffer())
  }
  return files.map((entry) => entry.path)
}

const handler = async (m, { conn }) => {
  const command = String(m.command || '').toLowerCase()
  if (command === 'restore') {
    const quoted = m.quoted
    if (!quoted?.download) return m.reply('Balas file ZIP backup dengan perintah .restore.')
    const status = await m.reply('Memulihkan database dan session... Bot akan restart setelah selesai.')

    let archivePath
    try {
      archivePath = await quoted.download(true)
      const restoredFiles = await restoreBackup(archivePath)
      await status.edit(`Restore selesai: ${restoredFiles.length} file dipulihkan. Bot akan restart.`)
      process.send?.('reset')
      setTimeout(() => process.exit(1), 500)
    } catch (error) {
      await status.edit(`Restore gagal: ${error.message || error}`)
    } finally {
      if (archivePath) await fs.promises.rm(archivePath, { force: true }).catch(() => {})
    }
    return
  }

  const status = await m.reply('Membuat backup database dan session...')
  await fs.promises.mkdir(backupDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `chitanda-backup-${stamp}.zip`
  const outputPath = path.join(backupDir, fileName)

  try {
    await createBackup(outputPath)
    await conn.sendMedia(m.from, outputPath, m, {
      mimetype: 'application/zip',
      fileName,
      caption: 'Backup database dan session Chitanda',
    })
    await status.edit('Backup selesai dan file sedang dikirim.')
  } finally {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {})
  }
}

handler.help = ['backup']
handler.tags = ['owner']
handler.command = /^(backup|backupdb|restore)$/i
handler.owner = true
handler.dev = true

export default handler

# Chitanda Bot

Bot WhatsApp berbasis **Zapo JS** dan **SQLite**, dengan arsitektur modular plugin, multi-session, dan penyimpanan data lokal yang modern.

> Dirancang native untuk Zapo — tanpa kompatibilitas Baileys lama. Semua state, nomor, dan setting tersimpan di SQLite (`db.sqlite`).

## Fitur Utama

- Bot WhatsApp native berbasis Zapo JS
- SQLite sebagai storage utama
- Multi-session: beberapa akun WhatsApp dalam satu project
- Plugin-based architecture dengan auto reload
- Support pairing code & QR auth
- Session management per akun
- Legacy database migration support

## Persyaratan

| Komponen | Minimum |
|----------|---------|
| Node.js | >= 20.9.0 |
| Package Manager | npm atau pnpm |
| Akun WhatsApp | 1 aktif |
| Akses internet | Diperlukan |

---

## Instalasi

### 🖥️ Local (Windows / macOS / Linux)

```bash
# 1. Clone repository
git clone https://github.com/haliq0841/Chitanda.git
cd Chitanda

# 2. Install dependencies
npm install

# 3. Salin file konfigurasi
cp config.js.example config.js        # macOS / Linux
copy config.js.example config.js      # Windows

# 4. Edit config.js — sesuaikan owner number
```

### ☁️ VPS (Ubuntu/Debian)

```bash
# 1. Update sistem & install Node.js 20
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# 2. (Opsional) Install PM2 untuk background process
sudo npm install -g pm2

# 3. Clone repository
git clone https://github.com/haliq0841/Chitanda.git
cd Chitanda

# 4. Install dependencies
npm install

# 5. Salin & edit konfigurasi
cp config.js.example config.js
nano config.js
```

---

## Konfigurasi Dasar

Edit `config.js`:

```js
let setting = {
  owner: ['6281234567890@s.whatsapp.net'],  // Ganti dengan nomor kamu
  noPrefix: false,                            // true = tanpa prefix
  usePairingCode: true,                       // true = pairing code, false = QR
}

export default setting
```

### Opsi Tambahan

| Opsi | Deskripsi |
|------|-----------|
| `self: true` | Mode personal — bot hanya untuk owner |
| `selfOwner: 'nomor@s.whatsapp.net'` | Nomor owner untuk mode self |

```js
// Contoh mode self (personal owner)
let setting = {
  owner: ['6281234567890@s.whatsapp.net'],
  noPrefix: false,
  usePairingCode: true,
  self: true,
  selfOwner: '6281234567890@s.whatsapp.net',
}
```

---

## Menjalankan Bot

```bash
# Jalankan semua session
node index.js

# Session tertentu
node index.js --session default
node index.js --session newnum

# Dengan pairing code manual
node index.js --session newnum --phone 6281234567890

# Mode self
node index.js --session self --phone 6281234567890

# Buat session baru interaktif
node index.js --newsession

# Jalankan semua session sekaligus
npm run start:all
```

### Manajemen Session

```bash
# Hapus session
node index.js --delete-session default
node index.js --delete-session all

# Alias hapus session
node index.js --reset-session default
node index.js --remove-session default

# List semua session
node index.js --list-sessions
```

### PM2 (Background Process)

```bash
# Single session
pm2 start index.js --name chitanda -- --session default

# Semua session
pm2 start start-all.js --name chitanda-all

# (atau) via ecosystem file
pm2 start ecosystem.config.cjs
```

---

## Multi-Session & Jadibot

Semua session tersimpan di SQLite. Setiap session punya metadata: `name`, `type`, `role`, `access`, `auth`, `number`, `autoStart`.

### Session Settings (dalam chat)

```text
.session set default type self
.session set default role dev
.session set default auth pairing
.session set default access owneronly on
.session set default access allowed 6281234567890@s.whatsapp.net
```

### Jadibot (User Menjadi Bot)

```text
.jadibot 6281234567890 nama-sesi
```

> Nomor akan menerima pairing code. Owner session = user yang menjalankan command. Role `dev` dan command `eval`, `exec`, `sf` hanya untuk developer utama.

---

## Database SQLite

Lokasi: `db.sqlite`

Tabel tersimpan: `users`, `groups`, `contacts`, `metadata`, `settings`, `stats`

Lihat isi database:
```bash
sqlite3 db.sqlite ".tables"
sqlite3 db.sqlite "SELECT * FROM users;"
```

### Migration dari DB Lama

```bash
node migrate-legacy.js            # Jalankan migrasi
node migrate-legacy.js --dry-run  # Simulasi tanpa menulis
```

---

## Membuat Plugin Baru

Buat file di `plugins/` — otomatis dimuat saat bot berjalan.

```js
const handler = async (m, { conn, db, usedPrefix }) => {
  await conn.message.send(m.from, {
    type: 'text',
    text: 'Halo! Plugin baru berhasil.'
  }, { quote: m })
}

handler.help = ['hello']
handler.tags = ['main']
handler.command = /^(hello|hallo)$/i

// Opsional:
// handler.owner = true    // hanya owner
// handler.group = true    // hanya group

export default handler
```

---

## Contoh Kirim Pesan

```js
// Kirim teks
await sock.message.send('6281234567890@s.whatsapp.net', {
  type: 'text',
  text: 'Halo dari bot!'
})

// Balas pesan
await sock.reply(m.from, 'Terima kasih sudah chat!', m)

// Kirim ke grup
await sock.message.send('120363123456789012@g.us', {
  type: 'text',
  text: 'Halo semua!'
})
```

---

## Struktur Project

```
Chitanda/
├── config.js              # Konfigurasi utama
├── config.js.example      # Template konfigurasi
├── index.js               # Entry point
├── main.js                # Core logic
├── handler.js             # Message handler
├── start-all.js           # Multi-session runner
├── ecosystem.config.cjs   # PM2 config
├── lib/                   # Utilities & database
├── plugins/               # Plugin folder (auto-load)
│   ├── after/
│   ├── downloader/
│   ├── maker/
│   ├── owner/
│   └── tools/
├── session/               # Session data
├── temp/                  # Temp files
└── tmp/                   # Temp files
```

---
## Troubleshooting

### 1. Bot tidak bisa login
- Pastikan `config.js` ada
- Pastikan `node_modules` sudah terinstall
- Coba hapus session lama jika nomor sebelumnya bermasalah

```bash
node index.js --delete-session default
```

### 2. Session tertimpa ketika daftar nomor baru
- Gunakan `--session` dengan nama yang berbeda

```bash
node index.js --session default
node index.js --session baru
```

### 3. Auth QR tidak muncul
- Pastikan `usePairingCode` diset sesuai
- Coba ubah ke `true` atau `false` tergantung kebutuhan

### 4. DB tidak terisi atau kosong
- Pastikan project sudah dijalankan minimal sekali
- Jalankan migrasi jika masih memakai data lama

```bash
node migrate-legacy.js --dry-run
```

## Tips keamanan

- Jangan commit file `config.js` ke repositori publik jika berisi data sensitif
- Jaga `db.sqlite` tetap aman
- Batasi owner akun dan nomor yang bisa mengakses bot
- Hindari menampilkan QR code di log publik

## Contoh konfigurasi lengkap

```js
let setting = {
  owner: ['6281234567890@s.whatsapp.net'],
  noPrefix: false,
  usePairingCode: true,
  self: true,
  selfOwner: '6281234567890@s.whatsapp.net',
}

export default setting
```

## Command cepat

```bash
npm install
copy config.js.example config.js
node index.js --session default
node index.js --session self --phone 6281234567890
npm run start:all
node index.js --delete-session default
node migrate-legacy.js
```

## Catatan penting

- Project ini adalah bot WhatsApp modern berbasis ZapoJS
- Semua session disimpan terpisah berdasarkan `sessionId`
- conn.sendMessage masih di dukung tetapi Tidak disarankan memakai pola lama/compatibility Baileys bila ingin murni native
- Database utama sekarang adalah SQLite, bukan `db.json` untuk state bot aktif

## Lisensi

Project ini menggunakan lisensi MIT. Lihat file `LICENSE` untuk detail lengkap.

## Support

Jika ingin mengembangkan project lebih lanjut, Anda bisa:

- menambah plugin baru di folder `plugins/`
- mengubah konfigurasi di `config.js`
- menambah feature di `handler.js`
- memperbarui struktur database di `lib/db.js`
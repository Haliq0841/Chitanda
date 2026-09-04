// gacha.js
function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

const pool = {
  "5": [50, 60, 70, 80, 100],
  "4": [10, 15, 20, 25, 30],
  "3": [5, 6, 7, 8, 9]
};

const rates = {
  "5": 0.006,  // 0.6%
  "4": 0.051,  // 5.1%
  "3": 0.943   // 94.3%
};

function gachaRoll(history) {
  const pity5 = 90; // pity 5★
  const pity4 = 10; // pity 4★

  // Hitung pity
  const rollsSince5 = history.rollsSince5 || 0;
  const rollsSince4 = history.rollsSince4 || 0;

  let rarity;

  // Cek pity 5★
  if (rollsSince5 + 1 >= pity5) {
    rarity = "5";
    history.rollsSince5 = 0;
    history.rollsSince4++;
  }
  // Cek pity 4★
  else if (rollsSince4 + 1 >= pity4) {
    rarity = "4";
    history.rollsSince4 = 0;
    history.rollsSince5++;
  }
  else {
    // Roll probabilitas normal
    const rand = Math.random();
    if (rand < rates["5"]) {
      rarity = "5";
      history.rollsSince5 = 0;
      history.rollsSince4++;
    } else if (rand < rates["5"] + rates["4"]) {
      rarity = "4";
      history.rollsSince4 = 0;
      history.rollsSince5++;
    } else {
      rarity = "3";
      history.rollsSince5++;
      history.rollsSince4++;
    }
  }

  const item = pool[rarity][getRandomInt(pool[rarity].length)];
  return { rarity, item, history };
}

const handler = async (m, { db, conn, isOwner }) => {
  const user = db.ensureUser?.(m.sender, { limit: 0, klaim: { rollsSince5: 0, rollsSince4: 0, last: 0 } }) || db.data.users[m.sender]
  user.klaim = user.klaim ?? { rollsSince5: 0, rollsSince4: 0, last: 0 }

  let time = user.klaim.last + 43200000
  if (new Date() - user.klaim.last < 43200000 && !isOwner) {
    throw `Kamu Sudah Mengambilnya\nDapat di ambil dalam ${msToTime(time - Date.now())} Lagi`
  }

  const roll = gachaRoll(user.klaim)
  user.limit = Number(user.limit || 0) + Number(roll.item)
  const caption = `*${roll.rarity === '3' ? '⭐⭐⭐' : roll.rarity === '4' ? '⭐⭐⭐⭐' : '⭐⭐⭐⭐⭐'}*\nSelamat Kamu Mendapatkan ${roll.item} Limit\nLimit kamu sekarang ${user.limit}`
  user.klaim = roll.history
  user.klaim.last = Date.now()
  await m.reply(caption)
}

handler.help = ['klaim']
handler.tags = ['main']
handler.command = /^((c|k)laim)$/i

export default handler

function msToTime(duration) {
  var milliseconds = parseInt((duration % 1000) / 100),
    seconds = Math.floor((duration / 1000) % 60),
    minutes = Math.floor((duration / (1000 * 60)) % 60),
    hours = Math.floor((duration / (1000 * 60 * 60)) % 24),
    monthly = Math.floor((duration / (1000 * 60 * 60 * 24)) % 720)

  monthly  = (monthly < 10) ? "0" + monthly : monthly
  hours = (hours < 10) ? "0" + hours : hours
  minutes = (minutes < 10) ? "0" + minutes : minutes
  seconds = (seconds < 10) ? "0" + seconds : seconds

  //return monthly + " Hari " +  hours + " Jam " + minutes + " Menit"
  return hours + " Jam " + minutes + " Menit"
}
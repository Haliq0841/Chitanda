import { isGroupJid, isLidJid, normalizeRecipientJid, toUserJid } from 'zapo-js'

export const normalizeJid = (value) => {
  if (!value) return ''
  const jid = normalizeRecipientJid(String(value).trim())
  return jid
}

export const isUserIdentity = (jid) => {
  const value = String(jid || '')
  return !isGroupJid(value) && !value.endsWith('@broadcast') && !value.endsWith('@newsletter') && !value.startsWith('status@')
}

export const toDatabaseJid = (jid) => {
  const normalized = normalizeJid(jid)
  return isUserIdentity(normalized) && normalized.endsWith('@lid') ? toUserJid(normalized) : normalized
}

export async function resolveLid(client, jid) {
  const normalized = normalizeJid(jid)
  if (!normalized || !isUserIdentity(normalized) || isLidJid(normalized)) return normalized

  const resolver = client?.privacy?.resolveUserJidPair
  if (typeof resolver === 'function') {
    try {
      const pair = await resolver(normalized)
      if (pair?.lidJid) return toUserJid(pair.lidJid)
    } catch {
      // A missing mapping should keep the canonical PN usable for sending.
    }
  }

  const contactStore = client?.privacy?.contactStore
  if (contactStore?.getByPhoneNumber) {
    try {
      const contact = await contactStore.getByPhoneNumber(normalized)
      if (contact?.lid) return toUserJid(contact.lid)
      if (contact?.jid && isLidJid(contact.jid)) return toUserJid(contact.jid)
    } catch {
      // The contact cache is only a fallback.
    }
  }

  return normalized
}

export async function resolveDatabaseJid(client, jid) {
  return toDatabaseJid(await resolveLid(client, jid))
}

export async function resolveOwnerJids(client, owners = []) {
  const list = Array.isArray(owners) ? owners : [owners]
  return [...new Set((await Promise.all(list.filter(Boolean).map((jid) => resolveDatabaseJid(client, jid)))).filter(Boolean))]
}

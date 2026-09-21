import { deriveKey, isEncrypted } from '../export/dump'

/**
 * Sidecar encryption. The envelope is the dump's own HRTH1 format byte for byte
 * (`'HRTH1' | 16 salt | 12 nonce | ciphertext`), so the folder holds one format and `isEncrypted`
 * recognises a sidecar for free.
 *
 * The key is derived once per run, not once per file: PBKDF2 runs 600 000 iterations, which is
 * half a second, and a hundred documents would otherwise block the tab for a minute on every
 * backup. A run's files share one salt and each gets its own nonce, which is what AES-GCM needs.
 */
const MAGIC = new TextEncoder().encode('HRTH1')
const SALT = 16
const NONCE = 12

export type Seal = (plain: Uint8Array) => Promise<Uint8Array>
export type Open = (bytes: Uint8Array) => Promise<Uint8Array>

export async function sealer(passphrase: string): Promise<Seal> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT))
  const key = await deriveKey(passphrase, salt)
  return async (plain) => {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE))
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, plain as BufferSource),
    )
    const out = new Uint8Array(MAGIC.length + SALT + NONCE + ct.length)
    out.set(MAGIC, 0)
    out.set(salt, MAGIC.length)
    out.set(nonce, MAGIC.length + SALT)
    out.set(ct, MAGIC.length + SALT + NONCE)
    return out
  }
}

/**
 * Opens sidecars, caching the one derived key. Files written by the same run share a salt, so a
 * whole folder normally costs one derivation; one written by another computer costs one more.
 */
export async function opener(passphrase: string): Promise<Open> {
  let cached: { salt: string; key: CryptoKey } | null = null
  return async (bytes) => {
    if (!isEncrypted(bytes)) throw new Error('not an encrypted attachment')
    const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT)
    const nonce = bytes.slice(MAGIC.length + SALT, MAGIC.length + SALT + NONCE)
    const ct = bytes.slice(MAGIC.length + SALT + NONCE)
    const id = Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('')
    if (cached?.salt !== id) cached = { salt: id, key: await deriveKey(passphrase, salt) }
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource },
        cached.key,
        ct as BufferSource,
      ),
    )
  }
}

export { isEncrypted }

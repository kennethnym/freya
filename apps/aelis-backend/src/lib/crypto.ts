import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/**
 * AES-256-GCM encryption for credential storage.
 *
 * Caches the parsed key on construction to avoid repeated
 * env reads and Buffer allocations.
 */
export class CredentialEncryptor {
	private readonly key: Buffer

	constructor(base64Key: string) {
		const key = Buffer.from(base64Key, "base64")
		if (key.length !== 32) {
			throw new Error(
				`Encryption key must be 32 bytes (got ${key.length}). Generate with: openssl rand -base64 32`,
			)
		}
		this.key = key
	}

	/**
	 * Encrypts plaintext using AES-256-GCM.
	 *
	 * Output format: [12-byte IV][ciphertext][16-byte auth tag]
	 */
	encrypt(plaintext: string): Buffer {
		const iv = randomBytes(IV_LENGTH)
		const cipher = createCipheriv(ALGORITHM, this.key, iv)

		const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
		const authTag = cipher.getAuthTag()

		return Buffer.concat([iv, encrypted, authTag])
	}

	/**
	 * Decrypts a buffer produced by `encrypt`.
	 *
	 * Expects format: [12-byte IV][ciphertext][16-byte auth tag]
	 */
	decrypt(data: Buffer): string {
		if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
			throw new Error("Encrypted data is too short")
		}

		const iv = data.subarray(0, IV_LENGTH)
		const authTag = data.subarray(data.length - AUTH_TAG_LENGTH)
		const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH)

		const decipher = createDecipheriv(ALGORITHM, this.key, iv)
		decipher.setAuthTag(authTag)

		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
	}
}

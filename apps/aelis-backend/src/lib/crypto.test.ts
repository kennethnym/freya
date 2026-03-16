import { randomBytes } from "node:crypto"
import { describe, expect, test } from "bun:test"

import { CredentialEncryptor } from "./crypto.ts"

const TEST_KEY = randomBytes(32).toString("base64")

describe("CredentialEncryptor", () => {
	const encryptor = new CredentialEncryptor(TEST_KEY)

	test("round-trip with simple string", () => {
		const plaintext = "hello world"
		const encrypted = encryptor.encrypt(plaintext)
		expect(encryptor.decrypt(encrypted)).toBe(plaintext)
	})

	test("round-trip with JSON credentials", () => {
		const credentials = JSON.stringify({
			accessToken: "ya29.a0AfH6SMB...",
			refreshToken: "1//0dx...",
			expiresAt: "2025-12-01T00:00:00Z",
		})
		const encrypted = encryptor.encrypt(credentials)
		expect(encryptor.decrypt(encrypted)).toBe(credentials)
	})

	test("round-trip with empty string", () => {
		const encrypted = encryptor.encrypt("")
		expect(encryptor.decrypt(encrypted)).toBe("")
	})

	test("round-trip with unicode", () => {
		const plaintext = "日本語テスト 🔐"
		const encrypted = encryptor.encrypt(plaintext)
		expect(encryptor.decrypt(encrypted)).toBe(plaintext)
	})

	test("each encryption produces different ciphertext (unique IV)", () => {
		const plaintext = "same input"
		const a = encryptor.encrypt(plaintext)
		const b = encryptor.encrypt(plaintext)
		expect(a).not.toEqual(b)
		expect(encryptor.decrypt(a)).toBe(plaintext)
		expect(encryptor.decrypt(b)).toBe(plaintext)
	})

	test("tampered ciphertext throws", () => {
		const encrypted = encryptor.encrypt("secret")
		encrypted[13]! ^= 0xff
		expect(() => encryptor.decrypt(encrypted)).toThrow()
	})

	test("truncated data throws", () => {
		expect(() => encryptor.decrypt(Buffer.alloc(10))).toThrow("Encrypted data is too short")
	})

	test("throws when key is wrong length", () => {
		expect(() => new CredentialEncryptor(Buffer.from("too-short").toString("base64"))).toThrow(
			"must be 32 bytes",
		)
	})
})

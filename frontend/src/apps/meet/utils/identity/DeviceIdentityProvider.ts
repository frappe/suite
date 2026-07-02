// E2EE device identity: per-device ed25519 auth keypair + device_id.
//
// The host's ed25519 public key is the device's identity anchor. The
// server stores it in `tabE2EE Device Key` and uses it to verify the
// host's signature when enabling E2EE on a meeting (see
// docs/adr/0003-per-device-host-identity.md).
//
// A separate per-device ed25519 *signing* keypair is used to sign
// media frames (sender authenticity under threat model B). The
// private signing key is stored in IndexedDB alongside the auth key.
// The signing public key is delivered to other participants via the
// host-signed envelope and cached per sender_id on the receiver.
//
// The private keys never leave the device; they're stored in
// IndexedDB as non-extractable CryptoKeys. Older JWK entries are migrated
// in place when read.
//
// Meeting secrets and X25519 meeting private keys are deliberately not
// persisted. Per ADR 0006, pagehide/reload requires a fresh ECDH.
//
// This module owns the DeviceIdentityProvider port. Two implementations
// live here: the production IndexedDB-backed provider and an in-memory
// provider for tests.

import { ed25519KeyPair, exportEd25519PublicKey } from "../media/e2ee";

export interface DeviceIdentity {
	deviceId: string;
	authKeyPair: CryptoKeyPair;
	authPublicKey: string;
	signingKeyPair: CryptoKeyPair;
	signingPublicKey: string;
}

export interface DeviceIdentityProvider {
	getIdentity(): Promise<DeviceIdentity>;
	clearCache(): void;
}

const DB_NAME = "Meet_E2EE";
const DB_VERSION = 3;
const STORE_NAME = "identity";
const DEVICE_ID_STORAGE_KEY = "meet:e2ee:device_id";

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
	});
}

type StoredIdentityKey = CryptoKey | JsonWebKey;

async function idbGet(key: string): Promise<StoredIdentityKey | null> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const req = store.get(key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve((req.result as StoredIdentityKey) ?? null);
		tx.oncomplete = () => db.close();
	});
}

async function idbPut(key: string, value: StoredIdentityKey): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const req = store.put(value, key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve();
		tx.oncomplete = () => db.close();
	});
}

function isCryptoKey(value: StoredIdentityKey): value is CryptoKey {
	return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

async function loadPrivateSigningKey(
	privateKeyId: string,
	stored: StoredIdentityKey,
): Promise<CryptoKey> {
	if (isCryptoKey(stored)) return stored;
	const privateKey = await globalThis.crypto.subtle.importKey(
		"jwk",
		stored,
		{ name: "Ed25519" },
		false,
		["sign"],
	);
	await idbPut(privateKeyId, privateKey);
	return privateKey;
}

async function loadPublicVerifyKey(
	publicKeyId: string,
	stored: StoredIdentityKey,
): Promise<CryptoKey> {
	if (isCryptoKey(stored)) return stored;
	const publicKey = await globalThis.crypto.subtle.importKey(
		"jwk",
		stored,
		{ name: "Ed25519" },
		true,
		["verify"],
	);
	await idbPut(publicKeyId, publicKey);
	return publicKey;
}

function generateDeviceId(): string {
	const bytes = new Uint8Array(12);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getOrCreateDeviceId(): string {
	const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
	if (existing && /^[a-zA-Z0-9._-]{1,64}$/.test(existing)) {
		return existing;
	}
	const next = generateDeviceId();
	localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
	return next;
}

async function loadOrCreateKeyPair(
	privateKeyId: string,
	publicKeyId: string,
): Promise<CryptoKeyPair> {
	const privJwk = await idbGet(privateKeyId);
	if (privJwk) {
		const privateKey = await loadPrivateSigningKey(privateKeyId, privJwk);
		const pubJwk = await idbGet(publicKeyId);
		const publicKey = pubJwk
			? await loadPublicVerifyKey(publicKeyId, pubJwk)
			: (null as unknown as CryptoKey);
		return { privateKey, publicKey };
	}
	const kp = await ed25519KeyPair();
	const privateKey = await globalThis.crypto.subtle.importKey(
		"jwk",
		await globalThis.crypto.subtle.exportKey("jwk", kp.privateKey),
		{ name: "Ed25519" },
		false,
		["sign"],
	);
	await idbPut(privateKeyId, privateKey);
	if (kp.publicKey) {
		await idbPut(publicKeyId, kp.publicKey);
	}
	return { privateKey, publicKey: kp.publicKey };
}

export class IndexedDBDeviceIdentityProvider implements DeviceIdentityProvider {
	#cached: Promise<DeviceIdentity> | null = null;

	async getIdentity(): Promise<DeviceIdentity> {
		if (!this.#cached) {
			this.#cached = this.#loadOrCreate();
		}
		return this.#cached;
	}

	clearCache(): void {
		this.#cached = null;
	}

	async #loadOrCreate(): Promise<DeviceIdentity> {
		const deviceId = getOrCreateDeviceId();
		const authKeyPair = await loadOrCreateKeyPair("authKey", "authPub");
		const signingKeyPair = await loadOrCreateKeyPair(
			"signingKey",
			"signingPub",
		);
		return {
			deviceId,
			authKeyPair,
			authPublicKey: authKeyPair.publicKey
				? await exportEd25519PublicKey(authKeyPair.publicKey)
				: "",
			signingKeyPair,
			signingPublicKey: await exportEd25519PublicKey(signingKeyPair.publicKey),
		};
	}
}

export class MemoryDeviceIdentityProvider implements DeviceIdentityProvider {
	#cached: Promise<DeviceIdentity> | null = null;
	#deviceId: string;

	constructor(deviceId?: string) {
		this.#deviceId =
			deviceId ??
			`mem-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
				b.toString(16).padStart(2, "0"),
			).join("")}`;
	}

	async getIdentity(): Promise<DeviceIdentity> {
		if (!this.#cached) {
			this.#cached = this.#generate();
		}
		return this.#cached;
	}

	clearCache(): void {
		this.#cached = null;
	}

	async #generate(): Promise<DeviceIdentity> {
		const deviceId = this.#deviceId;
		const authKeyPair = await ed25519KeyPair();
		const signingKeyPair = await ed25519KeyPair();
		return {
			deviceId,
			authKeyPair,
			authPublicKey: authKeyPair.publicKey
				? await exportEd25519PublicKey(authKeyPair.publicKey)
				: "",
			signingKeyPair,
			signingPublicKey: await exportEd25519PublicKey(signingKeyPair.publicKey),
		};
	}
}

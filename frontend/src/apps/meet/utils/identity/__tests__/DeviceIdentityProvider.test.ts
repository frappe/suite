import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDeviceIdentity } from "../../../composables/useDeviceIdentity";
import {
	IndexedDBDeviceIdentityProvider,
	MemoryDeviceIdentityProvider,
} from "../DeviceIdentityProvider";

const DB_NAME = "Meet_E2EE";
const DEVICE_ID_STORAGE_KEY = "meet:e2ee:device_id";

async function clearIndexedDB(): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.deleteDatabase(DB_NAME);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
		req.onblocked = () => resolve();
	});
}

function openIdentityDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 3);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains("identity")) {
				db.createObjectStore("identity");
			}
		};
	});
}

async function getStoredIdentityValue(key: string): Promise<unknown> {
	const db = await openIdentityDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction("identity", "readonly");
		const req = tx.objectStore("identity").get(key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		tx.oncomplete = () => db.close();
	});
}

async function putStoredIdentityValue(key: string, value: unknown): Promise<void> {
	const db = await openIdentityDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction("identity", "readwrite");
		const req = tx.objectStore("identity").put(value, key);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve();
		tx.oncomplete = () => db.close();
	});
}

function clearLocalStorage(): void {
	localStorage.removeItem(DEVICE_ID_STORAGE_KEY);
}

async function importEd25519PublicKey(raw: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		raw as BufferSource,
		{ name: "Ed25519" },
		true,
		["verify"],
	);
}

async function assertValidEd25519KeyPair(
	privateKey: CryptoKey,
	publicKey: CryptoKey,
): Promise<void> {
	const message = crypto.getRandomValues(new Uint8Array(64));
	const signature = await crypto.subtle.sign(
		"Ed25519",
		privateKey,
		message as BufferSource,
	);
	const valid = await crypto.subtle.verify(
		"Ed25519",
		publicKey,
		signature as BufferSource,
		message as BufferSource,
	);
	expect(valid).toBe(true);
}

function assertBase64(value: string): void {
	expect(value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
	expect(value.length).toBeGreaterThan(0);
}

describe("MemoryDeviceIdentityProvider", () => {
	it("returns the same identity across calls (caches the promise)", async () => {
		const provider = new MemoryDeviceIdentityProvider();
		const first = await provider.getIdentity();
		const second = await provider.getIdentity();
		expect(second).toBe(first);
	});

	it("produces a device id, ed25519 auth keypair, and ed25519 signing keypair", async () => {
		const provider = new MemoryDeviceIdentityProvider();
		const identity = await provider.getIdentity();
		expect(identity.deviceId).toMatch(/^mem-[a-f0-9]{16}$/);
		expect(identity.authKeyPair.privateKey).toBeDefined();
		expect(identity.authKeyPair.publicKey).toBeDefined();
		expect(identity.signingKeyPair.privateKey).toBeDefined();
		expect(identity.signingKeyPair.publicKey).toBeDefined();
		await assertValidEd25519KeyPair(
			identity.authKeyPair.privateKey,
			identity.authKeyPair.publicKey,
		);
		await assertValidEd25519KeyPair(
			identity.signingKeyPair.privateKey,
			identity.signingKeyPair.publicKey,
		);
	});

	it("exposes the public keys as base64", async () => {
		const provider = new MemoryDeviceIdentityProvider();
		const identity = await provider.getIdentity();
		assertBase64(identity.authPublicKey);
		assertBase64(identity.signingPublicKey);
	});

	it("separate instances are independent", async () => {
		const a = new MemoryDeviceIdentityProvider();
		const b = new MemoryDeviceIdentityProvider();
		const idA = await a.getIdentity();
		const idB = await b.getIdentity();
		expect(idA.deviceId).not.toBe(idB.deviceId);
		expect(idA.authPublicKey).not.toBe(idB.authPublicKey);
		expect(idA.signingPublicKey).not.toBe(idB.signingPublicKey);
	});

	it("clearCache rotates the keypairs but keeps the device id stable", async () => {
		const provider = new MemoryDeviceIdentityProvider();
		const before = await provider.getIdentity();
		provider.clearCache();
		const after = await provider.getIdentity();
		expect(after).not.toBe(before);
		expect(after.deviceId).toBe(before.deviceId);
		expect(after.authPublicKey).not.toBe(before.authPublicKey);
		expect(after.signingPublicKey).not.toBe(before.signingPublicKey);
	});

	it("public key base64 round-trips back to the raw public key bytes", async () => {
		const provider = new MemoryDeviceIdentityProvider();
		const identity = await provider.getIdentity();
		const rawAuth = new Uint8Array(
			await crypto.subtle.exportKey("raw", identity.authKeyPair.publicKey),
		);
		const decoded = Uint8Array.from(atob(identity.authPublicKey), (c) =>
			c.charCodeAt(0),
		);
		expect(decoded.length).toBe(rawAuth.length);
		expect(decoded.every((b, i) => b === rawAuth[i])).toBe(true);
		const reimported = await importEd25519PublicKey(decoded);
		expect(reimported).toBeDefined();
	});
});

describe("IndexedDBDeviceIdentityProvider", () => {
	beforeEach(async () => {
		await clearIndexedDB();
		clearLocalStorage();
	});

	afterEach(async () => {
		await clearIndexedDB();
		clearLocalStorage();
	});

	it("returns an identity and exposes valid ed25519 keypairs", async () => {
		const provider = new IndexedDBDeviceIdentityProvider();
		const identity = await provider.getIdentity();
		expect(identity.deviceId).toMatch(/^[a-f0-9]{24}$/);
		await assertValidEd25519KeyPair(
			identity.authKeyPair.privateKey,
			identity.authKeyPair.publicKey,
		);
		await assertValidEd25519KeyPair(
			identity.signingKeyPair.privateKey,
			identity.signingKeyPair.publicKey,
		);
	});

	it("persists the same identity across provider instances (re-reads from disk)", async () => {
		const first = new IndexedDBDeviceIdentityProvider();
		const identity1 = await first.getIdentity();

		const second = new IndexedDBDeviceIdentityProvider();
		const identity2 = await second.getIdentity();

		expect(identity2.deviceId).toBe(identity1.deviceId);
		expect(identity2.authPublicKey).toBe(identity1.authPublicKey);
		expect(identity2.signingPublicKey).toBe(identity1.signingPublicKey);
	});

	it("stores private device keys as non-extractable CryptoKeys", async () => {
		const provider = new IndexedDBDeviceIdentityProvider();
		const identity = await provider.getIdentity();

		expect(identity.authKeyPair.privateKey.extractable).toBe(false);
		expect(identity.signingKeyPair.privateKey.extractable).toBe(false);
		expect(await getStoredIdentityValue("authKey")).toBeInstanceOf(CryptoKey);
		expect(await getStoredIdentityValue("signingKey")).toBeInstanceOf(CryptoKey);
	});

	it("migrates legacy private JWKs to non-extractable CryptoKeys", async () => {
		const keyPair = await crypto.subtle.generateKey(
			{ name: "Ed25519" },
			true,
			["sign", "verify"],
		);
		localStorage.setItem(DEVICE_ID_STORAGE_KEY, "legacy-device");
		await putStoredIdentityValue(
			"authKey",
			await crypto.subtle.exportKey("jwk", keyPair.privateKey),
		);
		await putStoredIdentityValue("authPub", keyPair.publicKey);

		const provider = new IndexedDBDeviceIdentityProvider();
		const identity = await provider.getIdentity();

		expect(identity.deviceId).toBe("legacy-device");
		expect(identity.authKeyPair.privateKey.extractable).toBe(false);
		expect(await getStoredIdentityValue("authKey")).toBeInstanceOf(CryptoKey);
	});

	it("clearCache forces a re-read from disk on the next getIdentity call", async () => {
		const provider = new IndexedDBDeviceIdentityProvider();
		const identity1 = await provider.getIdentity();
		provider.clearCache();
		const identity2 = await provider.getIdentity();
		expect(identity2.deviceId).toBe(identity1.deviceId);
		expect(identity2.authPublicKey).toBe(identity1.authPublicKey);
	});

	it("regenerates a new identity if the IndexedDB store is cleared mid-life", async () => {
		const provider = new IndexedDBDeviceIdentityProvider();
		const before = await provider.getIdentity();
		provider.clearCache();
		await clearIndexedDB();
		clearLocalStorage();
		const after = await provider.getIdentity();
		expect(after.deviceId).not.toBe(before.deviceId);
		expect(after.authPublicKey).not.toBe(before.authPublicKey);
		expect(after.signingPublicKey).not.toBe(before.signingPublicKey);
	});
});

describe("useDeviceIdentity", () => {
	beforeEach(async () => {
		await clearIndexedDB();
		clearLocalStorage();
		useDeviceIdentity().clearCache();
	});

	afterEach(async () => {
		await clearIndexedDB();
		clearLocalStorage();
		useDeviceIdentity().clearCache();
	});

	it("returns a singleton default provider (IndexedDB-backed in production)", async () => {
		const a = useDeviceIdentity();
		const b = useDeviceIdentity();
		expect(a).toBe(b);
		const identity = await a.getIdentity();
		expect(identity.deviceId).toMatch(/^[a-f0-9]{24}$/);
	});

	it("destructure-safe: pulling getIdentity/clearCache off the view does not lose `this`", async () => {
		const { getIdentity, clearCache } = useDeviceIdentity();
		const identity = await getIdentity();
		expect(identity.deviceId).toMatch(/^[a-f0-9]{24}$/);
		clearCache();
		const next = await getIdentity();
		expect(next.deviceId).toBe(identity.deviceId);
		expect(next.authPublicKey).toBe(identity.authPublicKey);
	});
});

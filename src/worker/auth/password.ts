// Password hashing with PBKDF2-HMAC-SHA256 via the Web Crypto API.
//
// Why not Better Auth's default scrypt? scrypt runs in JavaScript and can exceed
// the Workers CPU-time budget per request. Web Crypto PBKDF2 runs natively in
// workerd. Workers caps PBKDF2 at 100,000 iterations, which we use here. The
// iteration count is stored in each hash so it can be raised later without
// invalidating existing passwords.
//
// Format: pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>

const ITERATIONS = 100_000;
const KEY_BITS = 256;
const encoder = new TextEncoder();

function toB64(bytes: ArrayBuffer | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (const b of arr) s += String.fromCharCode(b);
	return btoa(s);
}

function fromB64(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey("raw", encoder.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
	return new Uint8Array(bits);
}

/** Constant-time comparison so verification time does not leak where hashes differ. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await derive(password, salt, ITERATIONS);
	return `pbkdf2_sha256$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
	const parts = hash.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
	const iterations = Number(parts[1]);
	if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
	try {
		const expected = fromB64(parts[3]);
		const actual = await derive(password, fromB64(parts[2]), iterations);
		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}

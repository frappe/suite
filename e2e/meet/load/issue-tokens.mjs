import { createHmac } from "node:crypto";
import process from "node:process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		"meeting-id": { type: "string" },
		site: { type: "string", default: "load.test" },
		count: { type: "string", default: "8" },
		"start-index": { type: "string", default: "1" },
		"ttl-seconds": { type: "string", default: "3600" },
	},
	strict: true,
});

if (!values["meeting-id"]) throw new Error("--meeting-id is required");
const count = Number(values.count);
const startIndex = Number(values["start-index"]);
const ttlSeconds = Number(values["ttl-seconds"]);
if (!Number.isInteger(count) || count < 1) throw new Error("--count must be a positive integer");
if (!Number.isInteger(startIndex) || startIndex < 1) {
	throw new Error("--start-index must be a positive integer");
}
if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60) {
	throw new Error("--ttl-seconds must be at least 60");
}
if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");

const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const header = encoded({ alg: "HS256", typ: "JWT" });
const now = Math.floor(Date.now() / 1000);

for (let index = startIndex; index < startIndex + count; index += 1) {
	const userId = `load-${String(index).padStart(4, "0")}@example.invalid`;
	const name = `Load ${index}`;
	const payload = encoded({
		user_id: userId,
		user_name: name,
		meeting_id: values["meeting-id"],
		site: values.site,
		scope: "full",
		is_host: false,
		is_cohost: false,
		is_guest: false,
		e2ee_required: false,
		iat: now,
		exp: now + ttlSeconds,
	});
	const unsigned = `${header}.${payload}`;
	const signature = createHmac("sha256", process.env.JWT_SECRET)
		.update(unsigned)
		.digest("base64url");
	process.stdout.write(
		`${JSON.stringify({ userId, name, token: `${unsigned}.${signature}` })}\n`,
	);
}

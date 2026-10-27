import { inflateRawSync } from "node:zlib";

/** Every entry of a zip archive by name. Enough to read an `.xlsx` file without a dependency. */
function unzip(bytes: Buffer): Map<string, Buffer> {
	const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (end < 0) throw new Error("not a zip archive");
	const entries = new Map<string, Buffer>();
	let at = bytes.readUInt32LE(end + 16);
	for (let left = bytes.readUInt16LE(end + 10); left > 0; left -= 1) {
		const method = bytes.readUInt16LE(at + 10);
		const size = bytes.readUInt32LE(at + 20);
		const nameLength = bytes.readUInt16LE(at + 28);
		const local = bytes.readUInt32LE(at + 42);
		const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
		const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
		const data = bytes.subarray(start, start + size);
		entries.set(name, method === 8 ? inflateRawSync(data) : data);
		at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
	}
	return entries;
}

/** The text of an `.xlsx` file's worksheets and shared strings, where cell values live. */
export function xlsxCellText(bytes: Buffer): string {
	return [...unzip(bytes)]
		.filter(([name]) => name.startsWith("xl/worksheets/") || name === "xl/sharedStrings.xml")
		.map(([, data]) => data.toString("utf8"))
		.join("\n");
}

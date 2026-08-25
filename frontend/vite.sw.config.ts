import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// frappe renders files under www/ through Jinja before serving them, so a Jinja
// delimiter in the bundle would either be stripped or blow up the request.
const guardServedOutput = () => ({
	name: "slides-sw-output-guard",
	writeBundle(options, bundle) {
		const forbidden = ["{{", "{%", "{#", "process.env"];
		for (const fileName of Object.keys(bundle)) {
			const code = fs.readFileSync(path.join(options.dir!, fileName), "utf-8");
			const found = forbidden.filter((token) => code.includes(token));
			if (found.length) {
				throw new Error(`${fileName} must not contain ${found.join(", ")}`);
			}
		}
	},
});

export default defineConfig({
	root: __dirname,
	// suite/www holds hand-written templates: never clear it, never copy public/ into it
	publicDir: false,
	define: { "process.env.NODE_ENV": '"production"' },
	plugins: [guardServedOutput()],
	build: {
		outDir: "../suite/www",
		emptyOutDir: false,
		minify: false,
		sourcemap: false,
		target: "es2020",
		lib: {
			entry: path.resolve(__dirname, "src/apps/slides/service-worker.js"),
			formats: ["iife"],
			name: "slidesServiceWorker",
			fileName: () => "service-worker.js",
		},
	},
});

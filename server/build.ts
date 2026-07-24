import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
	entrypoints: [resolve(root, "server/index.ts")],
	outdir,
	target: "bun",
	minify: true,
	sourcemap: "external",
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

await cp(resolve(root, "public"), resolve(outdir, "public"), { recursive: true });
await cp(resolve(root, "templates"), resolve(outdir, "templates"), { recursive: true });
console.log("生产构建已生成：dist/");

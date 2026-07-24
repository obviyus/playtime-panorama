import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist-worker");
const template = (name: string) => resolve(root, "templates", name);
const destination = (...parts: string[]) => resolve(output, ...parts);

await rm(output, { recursive: true, force: true });
await mkdir(destination("guide"), { recursive: true });
await mkdir(destination("faq"), { recursive: true });
await mkdir(destination("leaderboard"), { recursive: true });

await Promise.all([
	cp(template("root.html"), destination("index.html")),
	cp(template("profile.html"), destination("profile.html")),
	cp(template("guide.html"), destination("guide", "index.html")),
	cp(template("faq.html"), destination("faq", "index.html")),
	cp(template("leaderboard.html"), destination("leaderboard", "index.html")),
	cp(resolve(root, "public", "assets"), destination("assets"), { recursive: true }),
	cp(resolve(root, "public", "favicon.svg"), destination("favicon.svg")),
	cp(resolve(root, "public", "site.webmanifest"), destination("site.webmanifest")),
]);

console.log("Cloudflare Workers 静态资源已生成：dist-worker/");

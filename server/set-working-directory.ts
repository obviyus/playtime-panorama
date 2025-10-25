import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

if (Bun.env.NODE_ENV === "production") {
	const modulePath = fileURLToPath(import.meta.url);
	const bundleDir = dirname(modulePath);

	try {
		process.chdir(bundleDir);
	} catch (error) {
		console.error(
			"Failed to adjust working directory for bundled assets:",
			error,
		);
	}
}

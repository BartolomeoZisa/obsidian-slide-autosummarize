import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error("version-bump.mjs must be run via `npm version`");
	process.exit(1);
}
for (const file of ["manifest.json", "package.json"]) {
	const data = JSON.parse(readFileSync(file, "utf8"));
	data.version = targetVersion;
	writeFileSync(file, JSON.stringify(data, null, "\t") + "\n");
}
console.log(`version bumped to ${targetVersion}`);

// Uses Microsoft's hosted PWABuilder service. No private site/session data is sent.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const [version = "1.0.0.0", output = ".data/windows-package"] = process.argv.slice(2);
if (!/^[1-9]\d{0,4}\.\d{1,5}\.\d{1,5}\.0$/.test(version)
  || version.split(".").some((part) => Number(part) > 65535)) {
  throw new Error("Use a four-part Windows version ending in .0 (each part <= 65535).");
}
const config = JSON.parse(await readFile("infra/windows/package.json", "utf8"));
const directory = resolve(output);
await mkdir(directory, { recursive: true });
async function get(url, options = {}) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(240_000), ...options });
  if (!response.ok) throw new Error(`Package request failed: HTTP ${response.status}`);
  return response;
}
const manifest = await (await get(config.manifestUrl)).json();
if (manifest.name !== config.name || manifest.id !== "/" || manifest.scope !== "/"
  || manifest.start_url !== "/" || manifest.display !== "standalone") {
  throw new Error("Production app identity changed; review before creating a Windows release.");
}
const icon = manifest.icons.find((entry) => entry.sizes === "512x512" && !entry.purpose);
const iconUrl = new URL(icon?.src, config.url);
if (iconUrl.origin !== new URL(config.url).origin || !iconUrl.pathname.startsWith("/pwa/")) {
  throw new Error("Expected the public Pipeline app icon.");
}
const iconBytes = Buffer.from(await (await get(iconUrl)).arrayBuffer());
const request = {
  name: config.name, packageId: config.packageId, applicationId: "App", url: config.url,
  version: version.split(".").slice(0, 3).join("."), allowSigning: true,
  publisher: { displayName: config.publisherDisplayName, commonName: config.publisher },
  generateModernPackage: true, classicPackage: { generate: false }, edgeHtmlPackage: { generate: false },
  edgeChannel: "stable", manifestUrl: config.manifestUrl, startUrl: config.url,
  resourceLanguage: "en-US", targetDeviceFamilies: ["Desktop"],
};
const response = await get("https://pwabuilder-windows-docker.azurewebsites.net/msix/generatezip", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
});
const archive = Buffer.from(await response.arrayBuffer());
if (archive.length > 10_000_000) throw new Error("Unexpected package size.");
await writeFile(resolve(directory, "pwabuilder.zip"), archive);
await writeFile(resolve(directory, "request.json"), JSON.stringify(request, null, 2) + "\n");
await writeFile(resolve(directory, "release.json"), JSON.stringify({
  ...config, version, packageFile: `Pipeline-${version}.msixbundle`, signed: false,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  archiveSha256: createHash("sha256").update(archive).digest("hex"),
}, null, 2) + "\n");
await writeFile(resolve(directory, "edge-policy.json"), JSON.stringify([{
  url: config.url, default_launch_container: "window", create_desktop_shortcut: true,
  fallback_app_name: config.name,
  custom_icon: { url: iconUrl.href, hash: createHash("sha256").update(iconBytes).digest("hex") },
}], null, 2) + "\n");
console.log(`Downloaded unsigned package to ${directory}. Run verify-package.py before signing.`);

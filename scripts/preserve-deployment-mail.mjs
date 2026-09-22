import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function deploymentMailSettings(environment, secrets, activation = "preserve") {
  if (!["preserve", "enabled", "disabled"].includes(activation)) throw new Error("Choose preserve, enabled or disabled for Meet the Client activation.");
  const mail = environment.filter(({ name }) => /^PIPELINE_(GRAPH_|MEET_CLIENT_)/u.test(name));
  const references = new Set(mail.map(({ secretRef }) => secretRef).filter(Boolean));
  const preservedSecrets = [...references].map((name) => {
    const secret = secrets.find((item) => item.name === name);
    if (!secret || !(secret.value || secret.keyVaultUrl)) throw new Error("An existing mail secret could not be preserved.");
    return secret.keyVaultUrl
      ? { name, keyVaultUrl: secret.keyVaultUrl, identity: secret.identity }
      : { name, value: secret.value };
  });
  return { environment: activateMeetClient(mail, activation), secrets: preservedSecrets };
}

function activateMeetClient(mail, activation) {
  if (activation === "preserve") return mail;
  return [...mail.filter(item => item.name !== "PIPELINE_MEET_CLIENT_LIVE_ENABLED"),
    { name: "PIPELINE_MEET_CLIENT_LIVE_ENABLED", value: activation === "enabled" ? "true" : "false" }];
}

function readAzure(args) {
  try {
    return JSON.parse(execFileSync("az", [...args, "--only-show-errors", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    throw new Error("Could not read existing Azure mail configuration; deployment stopped without changing it.");
  }
}

function main() {
  const [resourceGroup, appName, outputPath, bootstrap, activation = "preserve"] = process.argv.slice(2);
  if (!resourceGroup || !appName || !outputPath) throw new Error("Resource group, application name and output path are required.");
  const scope = ["--resource-group", resourceGroup, "--name", appName];
  const environment = bootstrap === "true" ? [] : readAzure(["containerapp", "show", ...scope, "--query", "properties.template.containers[0].env"]);
  const needsSecrets = environment.some(({ name, secretRef }) => /^PIPELINE_(GRAPH_|MEET_CLIENT_)/u.test(name) && secretRef);
  const settings = deploymentMailSettings(environment, needsSecrets ? readAzure(["containerapp", "secret", "list", ...scope, "--show-values"]) : [], activation);
  for (const secret of settings.secrets) {
    if (secret.value && process.env.GITHUB_ACTIONS === "true") process.stdout.write(`::add-mask::${secret.value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`);
  }
  writeFileSync(outputPath, JSON.stringify({ preservedMail: { value: settings } }), { mode: 0o600 });
  process.stdout.write(`Preserved ${settings.environment.length} mail settings and ${settings.secrets.length} secret bindings.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

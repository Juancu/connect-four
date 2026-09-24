import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function displayName(name) {
  return name.replace(/\p{L}+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function puzzleHtml({ groups, number, title, footer, discord }) {
  return template
    .replace("__PUZZLE_DATA__", () => JSON.stringify({ number, groups }).replace(/</g, "\\u003c"))
    .replace("/*__CLIENT__*/", () => client)
    .replace("<title>connectTag puzzle</title>", `<title>${title}</title>`)
    .replace("<h1>connectTag</h1>", "")
    .replace("Another puzzle: npm run puzzle", footer)
    .replace("__DISCORD__", () => discord);
}

function groupsFrom(daily) {
  if (!Array.isArray(daily) || daily.length !== 4) throw new Error("A daily puzzle needs exactly 4 categories.");
  return daily.map((group) => {
    if (!Array.isArray(group.images) || group.images.length !== 4) {
      throw new Error(`${group.name} needs exactly 4 pictures.`);
    }
    return {
      id: group.slug,
      name: displayName(group.name),
      cards: group.images.map((id) => ({ id })),
    };
  });
}

const dailiesDir = path.join(root, "data", "dailies");
const numbers = (await readdir(dailiesDir))
  .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
if (!numbers.length) throw new Error("Add a daily as data/dailies/1.json.");
const currentNumber = numbers.at(-1);

let clientId = "";
try {
  const config = JSON.parse(await readFile(path.join(root, "data", "discord.json"), "utf8"));
  clientId = String(config.clientId ?? "");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (clientId && !/^\d+$/.test(clientId)) throw new Error("data/discord.json clientId must be the numeric application id.");

const [template, client] = await Promise.all([
  readFile(path.join(root, "scripts", "puzzle.template.html"), "utf8"),
  readFile(path.join(root, "scripts", "puzzle-client.js"), "utf8"),
]);

const puzzles = new Map();
for (const number of numbers) {
  const daily = JSON.parse(await readFile(path.join(dailiesDir, `${number}.json`), "utf8"));
  puzzles.set(number, groupsFrom(daily));
}

const discord = clientId
  ? `<script type="module">
const clientId = ${JSON.stringify(clientId)};
const params = new URLSearchParams(location.search);
if (params.has("frame_id")) {
  const { DiscordSDK } = await import("https://esm.sh/@discord/embedded-app-sdk@1.9.0");
  const discordSdk = new DiscordSDK(clientId);
  await discordSdk.ready();
}
</script>`
  : "";

function withSources(groups, prefix) {
  return groups.map((group) => ({
    ...group,
    cards: group.cards.map((card) => ({ ...card, src: `${prefix}${card.id}.jpg` })),
  }));
}

const current = puzzles.get(currentNumber);
await writeFile(path.join(root, "daily.html"), puzzleHtml({
  groups: withSources(current, "data/art/"),
  number: currentNumber,
  title: "connectTag daily",
  footer: "Random puzzle: puzzle.html",
  discord: "",
}));
await writeFile(path.join(root, "data", "daily.json"), await readFile(path.join(dailiesDir, `${currentNumber}.json`)));

const siteImages = path.join(root, "site", "images");
await rm(siteImages, { recursive: true, force: true });
await mkdir(siteImages, { recursive: true });
const copied = new Set();
for (const groups of puzzles.values()) {
  for (const group of groups) {
    for (const card of group.cards) {
      if (copied.has(card.id)) continue;
      copied.add(card.id);
      await copyFile(
        path.join(root, "data", "art", `${card.id}.jpg`),
        path.join(siteImages, `${card.id}.jpg`),
      );
    }
  }
}

await writeFile(path.join(root, "site", "index.html"), puzzleHtml({
  groups: withSources(current, "images/"),
  number: currentNumber,
  title: "connectTag daily",
  footer: "",
  discord,
}));

for (const number of numbers) {
  const folder = path.join(root, "site", String(number));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "index.html"), puzzleHtml({
    groups: withSources(puzzles.get(number), "../images/"),
    number,
    title: `connectTag #${String(number).padStart(3, "0")}`,
    footer: "",
    discord: number === currentNumber ? discord : "",
  }));
}

const names = puzzles.get(currentNumber).map((group) => group.name).join(", ");
console.log(`Wrote daily ${String(currentNumber).padStart(3, "0")} (${names}). Earlier dailies: ${numbers.filter((number) => number !== currentNumber).join(", ") || "none"}.`);
if (!clientId) console.log("No Discord client id yet. Add it to data/discord.json and run npm run daily again.");

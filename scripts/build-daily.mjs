import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function displayName(name) {
  return name.replace(/\p{L}+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function puzzleHtml({ groups, title, footer, discord }) {
  return template
    .replace("__PUZZLE_DATA__", () => JSON.stringify({ number: 1, groups }).replace(/</g, "\\u003c"))
    .replace("/*__CLIENT__*/", () => client)
    .replace("<title>connectTag puzzle</title>", `<title>${title}</title>`)
    .replace("<h1>connectTag</h1>", "")
    .replace("Another puzzle: npm run puzzle", footer)
    .replace("__DISCORD__", () => discord);
}

const daily = JSON.parse(await readFile(path.join(root, "data", "daily.json"), "utf8"));
if (daily.length !== 4) throw new Error("The daily puzzle needs exactly 4 categories.");

let clientId = "";
try {
  const config = JSON.parse(await readFile(path.join(root, "data", "discord.json"), "utf8"));
  clientId = String(config.clientId ?? "");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (clientId && !/^\d+$/.test(clientId)) throw new Error("data/discord.json clientId must be the numeric application id.");

const groups = [];
for (const group of daily) {
  if (!Array.isArray(group.images) || group.images.length !== 4) {
    throw new Error(`${group.name} needs exactly 4 pictures.`);
  }
  groups.push({
    id: group.slug,
    name: displayName(group.name),
    cards: group.images.map((id) => ({ id })),
  });
}

const [template, client] = await Promise.all([
  readFile(path.join(root, "scripts", "puzzle.template.html"), "utf8"),
  readFile(path.join(root, "scripts", "puzzle-client.js"), "utf8"),
]);

const localGroups = groups.map((group) => ({
  ...group,
  cards: group.cards.map((card) => ({ ...card, src: `data/art/${card.id}.jpg` })),
}));
await writeFile(path.join(root, "daily.html"), puzzleHtml({
  groups: localGroups,
  title: "connectTag daily",
  footer: "Random puzzle: puzzle.html",
  discord: "",
}));

const siteImages = path.join(root, "site", "images");
await rm(siteImages, { recursive: true, force: true });
await mkdir(siteImages, { recursive: true });
for (const group of groups) {
  for (const card of group.cards) {
    await copyFile(
      path.join(root, "data", "art", `${card.id}.jpg`),
      path.join(siteImages, `${card.id}.jpg`),
    );
  }
}

const hostedGroups = groups.map((group) => ({
  ...group,
  cards: group.cards.map((card) => ({ ...card, src: `images/${card.id}.jpg` })),
}));
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
await writeFile(path.join(root, "site", "index.html"), puzzleHtml({
  groups: hostedGroups,
  title: "connectTag daily",
  footer: "",
  discord,
}));

const extras = (await readdir(siteImages)).filter((name) => !name.endsWith(".jpg"));
if (extras.length) console.log("Unexpected site files", extras);
console.log(`Wrote daily.html and site/index.html (${groups.map((group) => group.name).join(", ")})`);
if (!clientId) console.log("No Discord client id yet. Add it to data/discord.json and run npm run daily again.");

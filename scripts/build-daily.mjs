import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildHell } from "./build-hell.mjs";

const root = path.resolve(import.meta.dirname, "..");

function displayName(name) {
  return name.replace(/\p{L}+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function puzzleHtml({ groups, number, title, footer, discord, nav }) {
  return template
    .replace("__PUZZLE_DATA__", () => JSON.stringify({ number, groups }).replace(/</g, "\\u003c"))
    .replace("/*__CLIENT__*/", () => client)
    .replace("<title>connectTag puzzle</title>", `<title>${title}</title>`)
    .replace("<h1>connectTag</h1>", "")
    .replace("Another puzzle: npm run puzzle", footer)
    .replace("__NAV__", () => nav)
    .replace("__DISCORD__", () => discord);
}

function puzzleNav(number, hrefFor) {
  const index = numbers.indexOf(number);
  const previous = index > 0 ? numbers[index - 1] : null;
  const next = index < numbers.length - 1 ? numbers[index + 1] : null;
  const parts = [];
  if (previous) parts.push(`<a href="${hrefFor(previous)}">‹ Previous</a>`);
  parts.push(`<span>Puzzle #${number}</span>`);
  if (next) parts.push(`<a href="${hrefFor(next)}">Next ›</a>`);
  return `<nav class="puzzle-nav" aria-label="Puzzles">${parts.join("")}</nav>`;
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
  groups: withSources(current, "site/images/"),
  number: currentNumber,
  title: "connectTag daily",
  footer: "Random puzzle: puzzle.html",
  discord: "",
  nav: puzzleNav(currentNumber, (n) => `site/${n}/index.html`),
}));
await writeFile(path.join(root, "data", "daily.json"), await readFile(path.join(dailiesDir, `${currentNumber}.json`)));

const siteImages = path.join(root, "site", "images");
await mkdir(siteImages, { recursive: true });
const needed = new Set();
for (const groups of puzzles.values()) {
  for (const group of groups) {
    for (const card of group.cards) needed.add(card.id);
  }
}
for (const name of await readdir(siteImages)) {
  if (!needed.has(name.replace(/\.jpg$/, ""))) await rm(path.join(siteImages, name));
}
for (const id of needed) {
  const dest = path.join(siteImages, `${id}.jpg`);
  try {
    await copyFile(path.join(root, "data", "art", `${id}.jpg`), dest);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await access(dest);
  }
}

await writeFile(path.join(root, "site", "index.html"), puzzleHtml({
  groups: withSources(current, "images/"),
  number: currentNumber,
  title: "connectTag daily",
  footer: "",
  discord,
  nav: puzzleNav(currentNumber, (n) => `${n}/`),
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
    nav: puzzleNav(number, (n) => `../${n}/`),
  }));
}

const siteDir = path.join(root, "site");
for (const entry of await readdir(siteDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
  if (numbers.includes(Number(entry.name))) continue;
  await rm(path.join(siteDir, entry.name), { recursive: true, force: true });
}

const names = puzzles.get(currentNumber).map((group) => group.name).join(", ");
console.log(`Wrote daily ${String(currentNumber).padStart(3, "0")} (${names}). Earlier dailies: ${numbers.filter((number) => number !== currentNumber).join(", ") || "none"}.`);
if (!clientId) console.log("No Discord client id yet. Add it to data/discord.json and run npm run daily again.");
await buildHell();

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const USER_AGENT = "connectTag/0.1 (personal Connections-style tag game; game artwork)";
const intro = "Group four arts that share a Scryfall art tag.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cropOf(card) {
  if (card.image_uris?.art_crop) return card.image_uris.art_crop;
  for (const face of card.card_faces ?? []) {
    if (face.image_uris?.art_crop) return face.image_uris.art_crop;
  }
  return "";
}

async function fileReady(file) {
  try {
    const info = await stat(file);
    return info.size >= 2000;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function artUrl(id) {
  const response = await fetch(`https://api.scryfall.com/cards/${id}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Scryfall had no card ${id} (${response.status}).`);
  const url = cropOf(await response.json());
  if (!url) throw new Error(`Scryfall had no art crop for ${id}.`);
  return url;
}

async function downloadImage(url, file) {
  if (await fileReady(file)) return false;
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "image/*" } });
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt;
      lastError = new Error(`${url} returned ${response.status}`);
      await sleep(waitMs);
      continue;
    }
    if (!response.ok) {
      lastError = new Error(`${url} returned ${response.status}`);
      await sleep(400 * attempt);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2000) {
      lastError = new Error(`${url} was too small to be an image`);
      await sleep(400 * attempt);
      continue;
    }
    await writeFile(file, bytes);
    return true;
  }
  throw lastError ?? new Error(`Could not download ${url}`);
}

function shuffled(text) {
  const chars = [...text];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join("");
}

function letterBlock(texts) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ()'.,-";
  const extra = [...new Set(texts.join(""))].filter((char) => !alphabet.includes(char)).join("");
  const hidden = texts.filter((text) => text.length >= 3);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const block = shuffled(`${alphabet}${alphabet}${extra}${extra}`);
    const lower = block.toLowerCase();
    if (hidden.every((text) => !lower.includes(text.toLowerCase()))) return block;
  }
  throw new Error("Could not hide the category names in the letter block.");
}

function encodeText(text, block) {
  const spots = new Map();
  for (let index = 0; index < block.length; index += 1) {
    const list = spots.get(block[index]) ?? [];
    list.push(index);
    spots.set(block[index], list);
  }
  return [...text].map((char) => {
    const choices = spots.get(char);
    if (!choices?.length) throw new Error(`The letter block has no ${JSON.stringify(char)}.`);
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function groupsFrom(game, number) {
  if (!Array.isArray(game.groups) || game.groups.length !== 4) throw new Error(`Game ${number} needs exactly 4 categories.`);
  return game.groups.map((group) => {
    if (!group.slug || !group.name || !Array.isArray(group.images) || group.images.length !== 4) {
      throw new Error(`${group.name || "A category"} needs a slug, a name, and exactly 4 pictures.`);
    }
    return {
      id: group.slug,
      name: group.name,
      ...(group.note ? { note: group.note } : {}),
      cards: group.images.map((id) => ({ id })),
    };
  });
}

function page(template, client, groups, passwordHash, prefix, number) {
  const title = `Game ${number}`;
  const labels = groups.flatMap((group) => (group.note ? [group.name, group.note] : [group.name]));
  const letters = letterBlock(labels);
  const hiddenGroups = groups.map((group, index) => {
    const name = encodeText(group.name, letters);
    const note = group.note ? encodeText(group.note, letters) : null;
    const read = (indexes) => indexes.map((spot) => letters[spot]).join("");
    if (read(name) !== group.name || (note && read(note) !== group.note)) {
      throw new Error(`Could not rebuild the name for ${group.name}.`);
    }
    return {
      id: String(index),
      name,
      ...(note ? { note } : {}),
      cards: group.cards.map((card) => ({ id: card.id, src: `${prefix}${card.id}.jpg` })),
    };
  });
  const data = JSON.stringify({
    mode: "game",
    title,
    browseSeconds: 50,
    passwordHash,
    a: letters,
    groups: hiddenGroups,
  }).replace(/</g, "\\u003c");
  return template
    .replace("__PUZZLE_DATA__", () => data)
    .replace("/*__CLIENT__*/", () => client)
    .replace("<title>connectTag puzzle</title>", `<title>${title}</title>`)
    .replace("<h1>connectTag</h1>", "")
    .replace('<h1 id="gate-title">Game</h1>', `<h1 id="gate-title">${title}</h1>`)
    .replace('<div id="gate" hidden>', '<div id="gate">')
    .replace("<main>", "<main hidden>")
    .replace(intro, "Find 4 groups of 4 pictures.")
    .replace("Another puzzle: npm run puzzle", "")
    .replace("__NAV__", () => "")
    .replace("__DISCORD__", () => "");
}

async function buildOne(number, template, client) {
  const file = path.join(root, "data", "games", `${number}.json`);
  const game = JSON.parse(await readFile(file, "utf8"));
  const password = String(game.password ?? "").trim();
  if (!password) throw new Error(`Set a password in data/games/${number}.json.`);
  const groups = groupsFrom(game, number);
  const ids = groups.flatMap((group) => group.cards.map((card) => card.id));
  if (new Set(ids).size !== ids.length) throw new Error(`Game ${number} repeats a picture.`);

  const imageDir = path.join(root, "site", `game${number}`, "images");
  await mkdir(imageDir, { recursive: true });
  for (const id of ids) {
    const dest = path.join(imageDir, `${id}.jpg`);
    if (await fileReady(dest)) continue;
    const url = await artUrl(id);
    await downloadImage(url, dest);
    await sleep(120);
  }

  const passwordHash = createHash("sha256").update(password.toLowerCase(), "utf8").digest("hex");
  const slug = `game${number}`;
  await writeFile(path.join(root, `${slug}.html`), page(template, client, groups, passwordHash, `site/${slug}/images/`, number));
  await writeFile(path.join(root, "site", slug, "index.html"), page(template, client, groups, passwordHash, "images/", number));
  const names = groups.map((group) => group.name).join(", ");
  console.log(`Wrote /${slug} (${names}).`);
}

export async function buildGame() {
  const gamesDir = path.join(root, "data", "games");
  const numbers = (await readdir(gamesDir))
    .map((name) => /^(\d+)\.json$/.exec(name)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  if (!numbers.length) throw new Error("Add a game as data/games/1.json.");
  const [template, client] = await Promise.all([
    readFile(path.join(root, "scripts", "puzzle.template.html"), "utf8"),
    readFile(path.join(root, "scripts", "puzzle-client.js"), "utf8"),
  ]);
  for (const number of numbers) await buildOne(number, template, client);
}

const invokedDirectly = process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/build-game.mjs");
if (invokedDirectly) {
  buildGame().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

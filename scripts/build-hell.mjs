import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const artDir = path.join(root, "data", "hellart");
const intro = '<p class="intro">Group four arts that share a Scryfall art tag. <button type="button" class="info" id="info" aria-label="More information">i</button></p>';

const groups = [
  {
    id: "chess",
    name: "Chess",
    note: "(Knight, Bishop, Queen, King)",
    images: ["chess-1", "chess-2", "chess-3", "chess-4"],
  },
  {
    id: "feathers",
    name: "Feathers",
    images: ["feather-1", "feather-2", "feather-3", "feather-4"],
  },
  {
    id: "metal",
    name: "Metal",
    note: "(Copper, Bronze, Silver, Gold)",
    images: ["metal-1", "metal-2", "metal-3", "gold-4"],
  },
  {
    id: "secrets",
    name: "Secrets",
    images: ["secret-1", "secret-2", "secret-3", "secret-4"],
  },
];

function withSources(prefix) {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    ...(group.note ? { note: group.note } : {}),
    cards: group.images.map((id) => ({ id, src: `${prefix}${id}.jpg` })),
  }));
}

function page(template, client, prefix) {
  const data = JSON.stringify({ label: "Hell", groups: withSources(prefix) }).replace(/</g, "\\u003c");
  return template
    .replace("__PUZZLE_DATA__", () => data)
    .replace("/*__CLIENT__*/", () => client)
    .replace("<title>connectTag puzzle</title>", "<title>Hell</title>")
    .replace("<h1>connectTag</h1>", "")
    .replace(intro, "")
    .replace("Another puzzle: npm run puzzle", "")
    .replace("__DISCORD__", () => "");
}

export async function buildHell() {
  const [template, client] = await Promise.all([
    readFile(path.join(root, "scripts", "puzzle.template.html"), "utf8"),
    readFile(path.join(root, "scripts", "puzzle-client.js"), "utf8"),
  ]);
  await writeFile(path.join(root, "hell.html"), page(template, client, "data/hellart/"));

  const imageDir = path.join(root, "site", "hell", "images");
  await mkdir(imageDir, { recursive: true });
  for (const group of groups) {
    for (const id of group.images) {
      await copyFile(path.join(artDir, `${id}.jpg`), path.join(imageDir, `${id}.jpg`));
    }
  }
  await writeFile(path.join(root, "site", "hell", "index.html"), page(template, client, "images/"));
  console.log("Wrote /hell (Chess, Feathers, Metal, Secrets).");
}

const invokedDirectly = process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/build-hell.mjs");
if (invokedDirectly) {
  buildHell().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(await readFile(path.join(root, "data", "tags.json"), "utf8"));

const tags = catalog.tags
  .filter((tag) => tag.taggingCount >= 9 && tag.taggingCount <= 200)
  .map((tag) => ({
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    namespace: tag.namespace,
    type: tag.type,
    taggingCount: tag.taggingCount,
    description: tag.description ?? "",
  }))
  .sort(
    (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })
      || b.taggingCount - a.taggingCount,
  );

const [template, client] = await Promise.all([
  readFile(path.join(root, "scripts", "tag-picker.template.html"), "utf8"),
  readFile(path.join(root, "scripts", "tag-picker-client.js"), "utf8"),
]);

let savedPicks = [];
try {
  savedPicks = JSON.parse(await readFile(path.join(root, "data", "interesting-tags.json"), "utf8"))
    .map((tag) => ({ name: tag.name, slug: tag.slug, namespace: tag.namespace }));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const data = JSON.stringify(tags).replace(/</g, "\\u003c");
const saved = JSON.stringify(savedPicks).replace(/</g, "\\u003c");
const html = template
  .replace("__TAG_DATA__", () => data)
  .replace("__SAVED_PICKS__", () => saved)
  .replace("/*__CLIENT__*/", () => client);

const outFile = path.join(root, "tag-picker.html");
await writeFile(outFile, html);
console.log(`Wrote ${outFile}`);
console.log(`${tags.length} tags, ${Buffer.byteLength(html)} bytes`);

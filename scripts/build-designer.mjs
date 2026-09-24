import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const indexFile = path.join(root, "data", "artwork-index.json");

export async function buildDesigner() {
  let tags = [];
  try {
    const index = JSON.parse(await readFile(indexFile, "utf8"));
    tags = Object.values(index.tags ?? {})
      .filter((tag) => tag.complete && Array.isArray(tag.images) && tag.images.length > 0)
      .map((tag) => ({
        name: tag.name,
        slug: tag.slug,
        images: tag.images,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const [template, client] = await Promise.all([
    readFile(path.join(root, "scripts", "designer.template.html"), "utf8"),
    readFile(path.join(root, "scripts", "designer-client.js"), "utf8"),
  ]);
  const data = JSON.stringify(tags).replace(/</g, "\\u003c");
  const html = template
    .replace("__DESIGNER_DATA__", () => data)
    .replace("/*__CLIENT__*/", () => client);
  const outFile = path.join(root, "designer.html");
  await writeFile(outFile, html);
  console.log(`Designer: ${tags.length} categories in ${outFile}`);
}

const invokedDirectly = process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/build-designer.mjs");
if (invokedDirectly) {
  buildDesigner().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

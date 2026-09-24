const TAGS = JSON.parse(document.getElementById("designer-data").textContent);
const MAX_PER_TAG = 4;

const categories = document.querySelector("#categories");
const exportButton = document.querySelector("#export");
const status = document.querySelector("#status");
const jsonOut = document.querySelector("#json-out");
const summary = document.querySelector("#summary");

const picks = {};
try {
  localStorage.removeItem("connecttag.dailyPicks");
} catch {
  // Nothing stored to clear.
}

function selectedIds(slug) {
  const ids = picks[slug];
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

function render() {
  categories.replaceChildren();
  if (TAGS.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Pictures are still downloading. Reload this page in a little while.";
    categories.append(empty);
    updateSummary();
    return;
  }

  for (const tag of TAGS) {
    const chosen = new Set(selectedIds(tag.slug).filter((id) => tag.images.includes(id)));
    picks[tag.slug] = [...chosen];

    const section = document.createElement("section");
    section.className = "category";
    section.dataset.slug = tag.slug;

    const header = document.createElement("div");
    header.className = "category-head";
    const title = document.createElement("h2");
    title.textContent = tag.name;
    const count = document.createElement("span");
    count.textContent = `${chosen.size}/${MAX_PER_TAG}`;
    header.append(title, count);

    const row = document.createElement("div");
    row.className = "carousel";
    for (const id of tag.images) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shot";
      button.dataset.id = id;
      button.setAttribute("aria-pressed", String(chosen.has(id)));
      const image = document.createElement("img");
      image.src = `data/art/${id}.jpg`;
      image.alt = "";
      image.draggable = false;
      image.loading = "lazy";
      button.append(image);
      button.addEventListener("click", () => toggle(tag.slug, id));
      row.append(button);
    }

    section.append(header, row);
    categories.append(section);
  }
  updateSummary();
}

function toggle(slug, id) {
  const tag = TAGS.find((item) => item.slug === slug);
  const current = selectedIds(slug).filter((item) => tag.images.includes(item));
  const index = current.indexOf(id);
  if (index >= 0) current.splice(index, 1);
  else if (current.length < MAX_PER_TAG) current.push(id);
  picks[slug] = current;
  const section = categories.querySelector(`section[data-slug="${CSS.escape(slug)}"]`);
  if (!section) {
    render();
    return;
  }
  section.querySelector(".category-head span").textContent = `${current.length}/${MAX_PER_TAG}`;
  for (const button of section.querySelectorAll(".shot")) {
    button.setAttribute("aria-pressed", String(current.includes(button.dataset.id)));
  }
  updateSummary();
}

function readyGroups() {
  return TAGS
    .map((tag) => ({
      slug: tag.slug,
      name: tag.name,
      images: selectedIds(tag.slug).filter((id) => tag.images.includes(id)),
    }))
    .filter((group) => group.images.length === MAX_PER_TAG);
}

function updateSummary() {
  const ready = readyGroups().length;
  summary.textContent = `${ready} ${ready === 1 ? "category" : "categories"} with 4 pictures`;
  exportButton.disabled = ready === 0;
}

function setStatus(message) {
  status.textContent = message;
}

async function copyJson() {
  const groups = readyGroups();
  if (groups.length === 0) {
    setStatus("Pick 4 pictures in a category first.");
    return;
  }
  const text = JSON.stringify(groups, null, 2);
  jsonOut.hidden = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied ${groups.length} ${groups.length === 1 ? "category" : "categories"}.`);
      return;
    }
  } catch {
    // file:// pages often block the clipboard API.
  }
  jsonOut.hidden = false;
  jsonOut.value = text;
  jsonOut.focus();
  jsonOut.select();
  const copied = document.execCommand("copy");
  setStatus(copied
    ? `Copied ${groups.length} ${groups.length === 1 ? "category" : "categories"}.`
    : "Clipboard was blocked. The JSON is selected below — press Ctrl+C.");
}

exportButton.addEventListener("click", () => {
  copyJson();
});

render();

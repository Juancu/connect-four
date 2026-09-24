const TAGS = JSON.parse(document.getElementById("tag-data").textContent);
const SAVED_PICKS = JSON.parse(document.getElementById("saved-picks").textContent);
const STORAGE_KEY = "connecttag.pickedTagIds";

const tbody = document.querySelector("#tags");
const searchInput = document.querySelector("#search");
const showing = document.querySelector("#showing");
const picked = document.querySelector("#picked");
const empty = document.querySelector("#empty");
const copyButton = document.querySelector("#copy");
const clearButton = document.querySelector("#clear");
const status = document.querySelector("#status");
const jsonOut = document.querySelector("#json-out");
const namespaceButtons = [...document.querySelectorAll("[data-namespace]")];
const sortButtons = [...document.querySelectorAll("[data-sort]")];

const counts = { all: TAGS.length, artwork: 0, card: 0, print: 0 };
for (const tag of TAGS) counts[tag.namespace] = (counts[tag.namespace] ?? 0) + 1;
document.querySelector("#total").textContent = TAGS.length.toLocaleString("en-US");
for (const button of namespaceButtons) {
  const key = button.dataset.namespace;
  const label = button.dataset.label;
  button.textContent = `${label} ${counts[key].toLocaleString("en-US")}`;
}

let selectedOrder = initialOrder();
let selected = new Set(selectedOrder);
let namespace = "all";
let sortKey = "name";
let selectedOnly = false;
let query = "";

function loadSelected() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function initialOrder() {
  const known = new Set(TAGS.map((tag) => tag.id));
  const stored = loadSelected().filter((id) => known.has(id));
  const savedKeys = new Set(SAVED_PICKS.map((pick) => `${pick.namespace}:${pick.slug}`));
  const savedIds = TAGS
    .filter((tag) => savedKeys.has(`${tag.namespace}:${tag.slug}`))
    .map((tag) => tag.id);
  if (!stored.length) return savedIds;
  const have = new Set(stored);
  return [...savedIds.filter((id) => !have.has(id)), ...stored];
}

function saveSelected() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedOrder));
  } catch {
    // Opening the file from disk can block storage. Picks still work until the tab closes.
  }
}

function markLast() {
  for (const row of tbody.querySelectorAll(".is-last")) row.classList.remove("is-last");
  const lastId = selectedOrder[selectedOrder.length - 1];
  const label = document.querySelector("#last-picked");
  if (!lastId) {
    label.textContent = "";
    return;
  }
  const row = tbody.querySelector(`tr[data-id="${CSS.escape(lastId)}"]`);
  row?.classList.add("is-last");
  const tag = TAGS.find((item) => item.id === lastId);
  label.textContent = tag ? `Last picked: ${tag.name}` : "";
}

function renderRow(tag) {
  const tr = document.createElement("tr");
  tr.dataset.id = tag.id;
  tr.dataset.name = tag.name.toLowerCase();
  tr.dataset.namespace = tag.namespace;
  tr.dataset.count = String(tag.taggingCount);
  tr.dataset.haystack = `${tag.name}\n${tag.slug}\n${tag.description}`.toLowerCase();
  if (selected.has(tag.id)) tr.classList.add("is-selected");

  const checkCell = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selected.has(tag.id);
  checkbox.tabIndex = -1;
  checkbox.setAttribute("aria-label", `Mark ${tag.name}`);
  checkCell.append(checkbox);

  const nameCell = document.createElement("td");
  nameCell.className = "name";
  nameCell.textContent = tag.name;

  const namespaceCell = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = `pill pill-${tag.namespace}`;
  pill.textContent = tag.namespace;
  namespaceCell.append(pill);

  const countCell = document.createElement("td");
  countCell.className = "count";
  countCell.textContent = tag.taggingCount.toLocaleString("en-US");

  const descriptionCell = document.createElement("td");
  descriptionCell.className = "description";
  descriptionCell.textContent = tag.description || "—";
  if (!tag.description) descriptionCell.classList.add("is-empty");

  const linkCell = document.createElement("td");
  const link = document.createElement("a");
  link.href = `https://tagger.scryfall.com/tags/${encodeURIComponent(tag.namespace)}/${encodeURIComponent(tag.slug)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View";
  link.addEventListener("click", (event) => event.stopPropagation());
  linkCell.append(link);

  tr.append(checkCell, nameCell, namespaceCell, countCell, descriptionCell, linkCell);
  tr.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    if (event.target === checkbox) return;
    setSelected(tag.id, !selected.has(tag.id));
  });
  checkbox.addEventListener("change", () => {
    setSelected(tag.id, checkbox.checked);
  });
  return tr;
}

const fragment = document.createDocumentFragment();
for (const tag of TAGS) fragment.append(renderRow(tag));
tbody.append(fragment);

function setSelected(id, on) {
  selectedOrder = selectedOrder.filter((item) => item !== id);
  if (on) {
    selected.add(id);
    selectedOrder.push(id);
  } else {
    selected.delete(id);
  }
  const row = tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  if (row) {
    row.classList.toggle("is-selected", on);
    row.querySelector("input").checked = on;
  }
  saveSelected();
  markLast();
  updateCounts();
  if (selectedOnly) applyFilter();
}

function updateCounts() {
  picked.textContent = `${selected.size.toLocaleString("en-US")} picked`;
  copyButton.disabled = selected.size === 0;
  clearButton.disabled = selected.size === 0;
}

function applyFilter() {
  const q = query.trim().toLowerCase();
  let shown = 0;
  for (const row of tbody.children) {
    const hide =
      (namespace !== "all" && row.dataset.namespace !== namespace) ||
      (selectedOnly && !row.classList.contains("is-selected")) ||
      (q && !row.dataset.haystack.includes(q));
    row.hidden = hide;
    if (!hide) shown += 1;
  }
  showing.textContent = `${shown.toLocaleString("en-US")} shown`;
  empty.hidden = shown !== 0;
}

function applySort() {
  const rows = [...tbody.children];
  rows.sort((a, b) => {
    if (sortKey === "count") {
      return Number(b.dataset.count) - Number(a.dataset.count) || a.dataset.name.localeCompare(b.dataset.name);
    }
    return a.dataset.name.localeCompare(b.dataset.name) || Number(b.dataset.count) - Number(a.dataset.count);
  });
  tbody.append(...rows);
  for (const button of sortButtons) {
    const th = button.closest("th");
    const active = button.dataset.sort === sortKey;
    button.classList.toggle("is-active", active);
    th.setAttribute("aria-sort", active ? (sortKey === "count" ? "descending" : "ascending") : "none");
  }
}

function pickedTags() {
  return TAGS.filter((tag) => selected.has(tag.id))
    .map((tag) => tag.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

function setStatus(message) {
  status.textContent = message;
  window.dispatchEvent(new Event("resize"));
}

async function copyJson() {
  const tags = pickedTags();
  if (tags.length === 0) {
    setStatus("Pick at least one tag first.");
    return;
  }
  const text = JSON.stringify(tags, null, 2);
  jsonOut.hidden = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied ${tags.length.toLocaleString("en-US")} names.`);
      return;
    }
  } catch {
    // file:// pages often block the clipboard API. Fall through.
  }
  jsonOut.hidden = false;
  jsonOut.value = text;
  jsonOut.focus();
  jsonOut.select();
  const copied = document.execCommand("copy");
  setStatus(
    copied
      ? `Copied ${tags.length.toLocaleString("en-US")} names.`
      : "Clipboard was blocked. The JSON is selected below — press Ctrl+C.",
  );
}

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  applyFilter();
});

for (const button of namespaceButtons) {
  button.addEventListener("click", () => {
    namespace = button.dataset.namespace;
    for (const other of namespaceButtons) other.setAttribute("aria-pressed", String(other === button));
    applyFilter();
  });
}

document.querySelector("#selected-only").addEventListener("click", (event) => {
  selectedOnly = !selectedOnly;
  event.currentTarget.setAttribute("aria-pressed", String(selectedOnly));
  applyFilter();
});

for (const button of sortButtons) {
  button.addEventListener("click", () => {
    sortKey = button.dataset.sort;
    applySort();
  });
}

copyButton.addEventListener("click", () => {
  copyJson();
});

clearButton.addEventListener("click", () => {
  if (selected.size === 0) return;
  if (!confirm(`Clear ${selected.size.toLocaleString("en-US")} picked tags?`)) return;
  selected = new Set();
  selectedOrder = [];
  for (const row of tbody.querySelectorAll(".is-selected")) {
    row.classList.remove("is-selected");
    row.querySelector("input").checked = false;
  }
  saveSelected();
  markLast();
  updateCounts();
  applyFilter();
  setStatus("Picks cleared.");
});

saveSelected();
applySort();
applyFilter();
markLast();
updateCounts();
searchInput.focus();

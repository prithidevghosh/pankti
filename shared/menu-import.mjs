// Preserve Indic combining marks and numeric portion symbols such as 1/2.
// Fold common formatting and long-vowel transliterations such as naan / nan.
const words = (text) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[\s‐‑–—_-]+/gu, ' ');
const dish = (text) =>
  words(text)
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/ /g, '');
const signature = (item) =>
  JSON.stringify([dish(item.name), words(item.category), words(item.variant), item.price]);
const label = (item) => JSON.stringify([words(item.name), words(item.variant)]);

export function reviewMenuImport(menu, entries) {
  const known = new Map(menu.map((item) => [signature(item), 'Already on menu']));
  const labels = new Set(menu.map(label));
  return entries.map((item) => {
    const key = signature(item);
    const duplicate = known.get(key);
    if (duplicate) return { duplicate };
    const identity = label(item);
    if (labels.has(identity)) return { conflict: true };
    known.set(key, 'Repeated on upload');
    labels.add(identity);
    return {};
  });
}

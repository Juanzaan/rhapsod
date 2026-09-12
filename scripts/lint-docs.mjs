import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? markdownFiles(path)
      : entry.name.endsWith(".md")
        ? [path]
        : [];
  });
}
const files = [
  join(root, "README.md"),
  join(root, "README.es.md"),
  join(root, "CONTRIBUTING.md"),
  join(root, "CONTRIBUTING.es.md"),
  ...markdownFiles(join(root, "docs")),
];
const errors = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const spanish = file.endsWith(".es.md");
  const counterpart = spanish
    ? file.replace(/\.es\.md$/, ".md")
    : file.replace(/\.md$/, ".es.md");
  if (!existsSync(counterpart))
    errors.push(`${file}: missing language counterpart`);
  const languageLink = spanish ? /^\[English\]\(/m : /^\[Español\]\(/m;
  if (!languageLink.test(text.split("\n").slice(0, 5).join("\n")))
    errors.push(`${file}: missing language link at top`);
  if (
    /[\u2013\u2014\u2018\u2019\u201c\u201d]|\p{Extended_Pictographic}/u.test(
      text,
    )
  )
    errors.push(`${file}: use plain punctuation and no decorative emoji`);
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split("#")[0]);
    if (target && !existsSync(resolve(dirname(file), target)))
      errors.push(`${file}: missing link target ${target}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Validated language pairs and local links in ${files.length} documents.`,
  );

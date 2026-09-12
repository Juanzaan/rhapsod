import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const repository = "Juanzaan/rhapsod";
const sections = {
  en: ["Summary", "Changes", "Upgrade", "Verification"],
  es: ["Resumen", "Cambios", "Actualización", "Verificación"],
};

export function validateNotes(content, language) {
  if (!sections[language]) throw new Error(`Unknown language: ${language}`);
  const headings = [...content.matchAll(/^## (.+)$/gm)].map(
    (match) => match[1],
  );
  if (JSON.stringify(headings) !== JSON.stringify(sections[language])) {
    throw new Error(
      `Expected ${language} sections: ${sections[language].join(", ")}`,
    );
  }
  for (const section of content.split(/^## .+$/m).slice(1)) {
    if (!section.trim()) throw new Error("Release sections must not be empty");
  }
  if (
    /\b(?:TODO|TBD)\b|[\u2013\u2014\u2018\u2019\u201c\u201d\ufeff]|^(?:<{7}|={7}|>{7})/m.test(
      content,
    )
  ) {
    throw new Error(
      "Release notes contain placeholders, conflict markers, or unsupported punctuation",
    );
  }
}

export function renderRelease(tag, english, spanish, previous) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    throw new Error(`Invalid release tag: ${tag}`);
  if (previous !== undefined && !/^v\d+\.\d+\.\d+$/.test(previous)) {
    throw new Error(`Invalid previous tag: ${previous}`);
  }
  validateNotes(english, "en");
  validateNotes(spanish, "es");
  const base = `https://github.com/${repository}`;
  english = english.replace(/^\[Español\]\([^\n]+\)\s*/, "");
  spanish = spanish.replace(/^\[English\]\([^\n]+\)\s*/, "");
  const source = previous
    ? `${base}/compare/${previous}...${tag}`
    : `${base}/tree/${tag}`;
  return `${english.trim()}\n\n## Links\n\n- [Source and full diff](${source})\n- [Documentation at ${tag}](${base}/tree/${tag}/docs)\n\n<details>\n<summary>Español</summary>\n\n${spanish.trim()}\n\n## Enlaces\n\n- [Código y diferencias](${source})\n- [Documentación de ${tag}](${base}/tree/${tag}/docs)\n\n</details>\n`;
}

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function loadRelease(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    throw new Error(`Invalid release tag: ${tag}`);
  const manifest = JSON.parse(
    readFileSync(resolve(root, "docs/releases/index.json"), "utf8"),
  );
  const entry = manifest.find((release) => release.tag === tag);
  if (!entry) throw new Error(`No archived release notes for ${tag}`);
  const stem = tag;
  const english = readFileSync(
    resolve(root, `docs/releases/${stem}.md`),
    "utf8",
  );
  const spanish = readFileSync(
    resolve(root, `docs/releases/${stem}.es.md`),
    "utf8",
  );
  const previous = entry.previous;
  return renderRelease(tag, english, spanish, previous);
}

function main() {
  const [command, tag, ...extra] = process.argv.slice(2);
  if (command === "check" && tag === undefined) {
    const manifest = JSON.parse(
      readFileSync(resolve(root, "docs/releases/index.json"), "utf8"),
    );
    const tags = new Set();
    for (const [index, entry] of manifest.entries()) {
      if (tags.has(entry.tag) || entry.previous !== manifest[index - 1]?.tag) {
        throw new Error(`Invalid release chain at ${entry.tag}`);
      }
      tags.add(entry.tag);
      loadRelease(entry.tag);
    }
    const version = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ).version;
    if (manifest.at(-1)?.tag !== `v${version}`) {
      throw new Error(
        `Archive notes for v${version} before merging the release PR`,
      );
    }
    for (const file of readdirSync(resolve(root, "docs/releases"))) {
      if (file.endsWith(".md")) {
        validateNotes(
          readFileSync(resolve(root, "docs/releases", file), "utf8"),
          file.endsWith(".es.md") ? "es" : "en",
        );
      }
    }
    console.log(
      `Validated ${tags.size} releases and unreleased notes in both languages.`,
    );
    return;
  }
  if (!["render", "sync"].includes(command) || !tag || extra.length) {
    throw new Error(
      "Usage: node scripts/release-notes.mjs check | render <tag> | sync <tag>",
    );
  }
  const body = loadRelease(tag);
  if (command === "render") {
    process.stdout.write(body);
    return;
  }
  const release = JSON.parse(
    gh(["api", `repos/${repository}/releases/tags/${tag}`]),
  );
  const name = `Rhapsod ${tag}`;
  if (release.body === body && release.name === name) {
    console.log(`${tag}: already synchronized`);
    return;
  }
  gh(
    [
      "api",
      "--method",
      "PATCH",
      `repos/${repository}/releases/${release.id}`,
      "--input",
      "-",
    ],
    JSON.stringify({ name, body }),
  );
  const updated = JSON.parse(
    gh(["api", `repos/${repository}/releases/tags/${tag}`]),
  );
  if (updated.body !== body || updated.name !== name)
    throw new Error(`Verification failed for ${tag}`);
  console.log(`${tag}: synchronized and verified`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();

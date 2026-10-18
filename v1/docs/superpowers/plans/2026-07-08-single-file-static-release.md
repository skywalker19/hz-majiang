# Single-File Static Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a mobile-friendly `dist/index.html` that contains the complete Hangzhou Mahjong assistant and can be served by Nginx without any other runtime component.

**Architecture:** Keep the tested ES-module source as the development form. Add a dependency-free Node build script that removes module boundaries in dependency order, embeds JavaScript and CSS into the existing HTML shell, and writes one deterministic release file.

**Tech Stack:** Node.js built-in modules, HTML5, inline CSS, inline vanilla JavaScript, Node.js built-in test runner.

## Global Constraints

- The only required deployment artifact is `dist/index.html`.
- The release file must not reference local CSS, JavaScript, images, fonts, CDNs, or network APIs.
- Nginx only serves the generated file; Node.js is not required on the server.
- The release must preserve `localStorage` match recovery and all existing scoring/dealing behavior.
- The release remains mobile-first for 360–430px portrait screens, includes safe-area handling, 44px touch targets, and reduced-motion support.
- Actual visual browser testing remains user-owned; deterministic tests and static release checks are required here.

---

### Task 1: Deterministic Single-File Builder

**Files:**
- Create: `scripts/build-single-file.mjs`
- Create: `tests/build-single-file.test.js`
- Modify: `package.json`
- Modify: `styles.css`
- Generate: `dist/index.html`

**Interfaces:**
- Consumes: `index.html`, `styles.css`, `js/rules.js`, `js/dealing.js`, `js/state.js`, `js/app.js`.
- Produces: `buildSingleFile({ rootDir, outputDir }) -> Promise<{ outputPath: string, html: string }>` and the `npm run build` command.

- [ ] **Step 1: Write the failing release test**

Create `tests/build-single-file.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSingleFile } from '../scripts/build-single-file.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('builds one self-contained mobile-friendly release file', async () => {
  const { outputPath, html } = await buildSingleFile({ rootDir, outputDir: resolve(rootDir, 'dist') });
  assert.equal(await readFile(outputPath, 'utf8'), html);
  assert.match(html, /<style>[\s\S]*--felt:/);
  assert.match(html, /<script>[\s\S]*calculateSettlement/);
  assert.doesNotMatch(html, /href=["']styles\.css/);
  assert.doesNotMatch(html, /src=["']js\//);
  assert.doesNotMatch(html, /type=["']module/);
  assert.doesNotMatch(html, /^\s*(?:import|export)\s/m);
  assert.match(html, /width=device-width/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /@media \(max-width: 430px\)/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /min-height: 44px/);
  assert.match(html, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run the test and verify the missing-builder failure**

Run: `npm test`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/build-single-file.mjs`.

- [ ] **Step 3: Implement the builder**

Create `scripts/build-single-file.mjs` with this interface and transformation:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulePaths = ['js/rules.js', 'js/dealing.js', 'js/state.js', 'js/app.js'];

function removeModuleSyntax(source) {
  return source
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

function protectInlineScript(source) {
  return source.replaceAll('</script', '<\\/script');
}

export async function buildSingleFile({ rootDir = defaultRoot, outputDir = resolve(rootDir, 'dist') } = {}) {
  const [shell, css, ...modules] = await Promise.all([
    readFile(resolve(rootDir, 'index.html'), 'utf8'),
    readFile(resolve(rootDir, 'styles.css'), 'utf8'),
    ...modulePaths.map((path) => readFile(resolve(rootDir, path), 'utf8')),
  ]);
  const cssLink = '    <link rel="stylesheet" href="styles.css">';
  const moduleScript = '    <script type="module" src="js/app.js"></script>';
  if (!shell.includes(cssLink) || !shell.includes(moduleScript)) throw new Error('开发页缺少预期的 CSS 或模块脚本标签');
  const bundledScript = modules.map(removeModuleSyntax).join('\n\n');
  const html = shell
    .replace(cssLink, `    <style>\n${css}\n    </style>`)
    .replace(moduleScript, `    <script>\n(() => {\n'use strict';\n${protectInlineScript(bundledScript)}\n})();\n    </script>`);
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'index.html');
  await writeFile(outputPath, html, 'utf8');
  return { outputPath, html };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { outputPath } = await buildSingleFile();
  console.log(`Built ${outputPath}`);
}
```

Also raise the two sub-44px mobile controls in `styles.css`: change the player-name input height from `38px` to `44px`, and the die button `min-height` from `43px` to `44px`. These exact values make the release test's touch-target assertion meaningful.

- [ ] **Step 4: Add the build command and run all tests**

Add `"build": "node scripts/build-single-file.mjs"` to `package.json` scripts.

Run: `npm test`

Expected: 66 tests pass with zero failures.

- [ ] **Step 5: Generate and inspect the release**

Run: `npm run build`

Expected: prints an absolute `dist/index.html` path and exits 0.

Run: `test "$(find dist -maxdepth 1 -type f | wc -l | tr -d ' ')" = "1" && test -s dist/index.html`

Expected: exit 0; `dist/` contains one non-empty file.

- [ ] **Step 6: Commit the builder and release artifact**

```bash
git add package.json styles.css scripts/build-single-file.mjs tests/build-single-file.test.js dist/index.html
git commit -m "feat: add single-file static release"
```

---

### Task 2: Nginx-Style Static Verification

**Files:**
- Verify: `dist/index.html`

**Interfaces:**
- Consumes: the generated `dist/index.html`.
- Produces: evidence that a static server can serve the sole artifact and that all required resources are embedded.

- [ ] **Step 1: Run the complete deterministic verification**

Run: `npm test && npm run build && node --check js/app.js && git diff --check`

Expected: 66 tests pass, the build exits 0, syntax check exits 0, and diff check prints no errors.

- [ ] **Step 2: Serve only the release directory**

Run from `dist/`: `python3 -m http.server 8000`

In another shell run: `curl -sS -I http://127.0.0.1:8000/`

Expected: `HTTP/1.0 200 OK` with `Content-type: text/html`.

- [ ] **Step 3: Verify the served release has no external asset dependencies**

Run: `curl -sS http://127.0.0.1:8000/ | rg -n 'src="js/|href="styles\.css|type="module"|https?://'`

Expected: no matches and `rg` exits 1.

- [ ] **Step 4: Stop the static server and report the artifact**

Stop the server with `Ctrl-C`. Report the absolute `dist/index.html` path, file size, test count, and that mobile visual verification remains for the user to perform on a phone.

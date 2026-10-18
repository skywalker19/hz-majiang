import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSingleFile } from '../scripts/build-single-file.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('builds one self-contained mobile-friendly release file', async () => {
  const { outputPath, html } = await buildSingleFile({
    rootDir,
    outputDir: resolve(rootDir, 'dist'),
  });

  assert.equal(await readFile(outputPath, 'utf8'), html);
  assert.match(html, /<style>[\s\S]*--felt:/);
  assert.match(html, /<script>[\s\S]*calculateSettlement/);
  assert.doesNotMatch(html, /href=["']styles\.css/);
  assert.doesNotMatch(html, /src=["']js\//);
  assert.doesNotMatch(html, /type=["']module/);
  assert.doesNotMatch(html, /^\s*(?:import|export)\s/m);
  assert.doesNotMatch(html, /https?:\/\/(?:huggingface\.co|hf\.co)\//);
  assert.match(html, /name="mahjong-model-base" content="\.\/models\/"/);
  assert.match(html, /env\.allowRemoteModels = false/);
  assert.match(html, /width=device-width/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /@media \(max-width: 430px\)/);
  assert.match(html, /safe-area-inset-bottom/);
  assert.match(html, /min-height: 44px/);
  assert.match(html, /prefers-reduced-motion/);
});

test('preserves dollar pairs in a parseable inline script', async () => {
  const { html } = await buildSingleFile({
    rootDir,
    outputDir: resolve(rootDir, 'dist'),
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

  assert.ok(script, 'release must contain one inline script');
  assert.match(script, /const \$\$ =/);
  assert.doesNotThrow(() => new Function(script));
});

test('places the inline script after the application markup', async () => {
  const { html } = await buildSingleFile({
    rootDir,
    outputDir: resolve(rootDir, 'dist'),
  });

  assert.ok(html.indexOf('<script>') > html.indexOf('id="setup-form"'));
  assert.ok(html.indexOf('</script>') < html.indexOf('</body>'));
});

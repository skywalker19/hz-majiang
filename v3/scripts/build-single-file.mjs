import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulePaths = ['js/rules.js', 'js/dealing.js', 'js/state.js', 'js/speech.js', 'js/voice-app.js', 'js/app.js'];

function removeModuleSyntax(source) {
  return source
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

function protectInlineScript(source) {
  return source.replaceAll('</script', '<\\/script');
}

export async function buildSingleFile({
  rootDir = defaultRoot,
  outputDir = resolve(rootDir, 'dist'),
} = {}) {
  const [shell, css, ...modules] = await Promise.all([
    readFile(resolve(rootDir, 'index.html'), 'utf8'),
    readFile(resolve(rootDir, 'styles.css'), 'utf8'),
    ...modulePaths.map((path) => readFile(resolve(rootDir, path), 'utf8')),
  ]);

  const cssLink = '    <link rel="stylesheet" href="styles.css">';
  const moduleScript = '    <script type="module" src="js/app.js"></script>';
  if (!shell.includes(cssLink) || !shell.includes(moduleScript)) {
    throw new Error('开发页缺少预期的 CSS 或模块脚本标签');
  }

  const bundledScript = modules.map(removeModuleSyntax).join('\n\n');
  const inlineScript = `    <script>\n(() => {\n'use strict';\n${protectInlineScript(bundledScript)}\n})();\n    </script>`;
  const shellWithInlineStyles = shell
    .replace(cssLink, () => `    <style>\n${css}\n    </style>`)
    .replace(moduleScript, '');
  const html = shellWithInlineStyles.replace(
    '</body>',
    () => `${inlineScript}\n  </body>`,
  );

  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'index.html');
  await writeFile(outputPath, html, 'utf8');
  return { outputPath, html };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { outputPath } = await buildSingleFile();
  console.log(`Built ${outputPath}`);
}

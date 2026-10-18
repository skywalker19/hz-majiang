import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingleFile } from './build-single-file.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(rootDir, 'release');
const name = 'mahjong-v3-speech';
await buildSingleFile({ rootDir });
await mkdir(releaseDir, { recursive: true });
const temporary = await mkdtemp(resolve(releaseDir, '.staging-'));
const stage = resolve(temporary, name);
try {
await mkdir(stage, { recursive: true });
await cp(resolve(rootDir, 'dist'), resolve(stage, 'dist'), {
  recursive: true,
  filter: (source) => basename(source) !== 'models',
});
await writeFile(resolve(stage, 'README.md'), `# 杭州麻将 v3 · 语音播报版

只需把 dist/index.html 覆盖到麻将网页的静态目录，然后刷新页面。

- 使用设备系统中文声音；首次点“试听声音”，确认媒体音量已开启。
- 确认结算后自动播报本局与累计分数、下一局庄家和老数；可关闭自动播报。
- 支持手动播报分数、庄家、起牌位置，以及重听和停止。
- 手机不录音，不下载或初始化模型，不连接识别/纠错服务；无需部署后端。
- 系统声音是否联网由设备决定。实际发声与音量仍需在目标手机确认。
- 版本：2026-10-17.9-speech。
`);
const archive = resolve(releaseDir, `${name}.tar.gz`);
const pending = resolve(temporary, `${name}.tar.gz`);
execFileSync('tar', ['-czf', pending, '-C', temporary, name]);
await rename(pending, archive);
console.log(`Packaged ${archive} (static page with system speech output)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingleFile } from './build-single-file.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = resolve(rootDir, 'release');
const name = 'mahjong-v4-fun';
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
await writeFile(resolve(stage, 'README.md'), `# 杭州麻将 v4 · 赏桂品茗国粹馆

请把 dist/ 内的全部内容上传到麻将网页的静态目录，保持文件结构后刷新页面。
这次需要同时上传 index.html、apple-touch-icon.png、site.webmanifest 和 icons/ 目录，不能只替换 index.html。

- 新图标为绿底、白色麻将牌和绿色繁体“發”，同时用于浏览器图标与手机主屏幕入口。
- iPhone Safari 打开部署后的网页，点“分享 → 添加到主屏幕 → 添加”，即可读取主屏幕图标。主屏幕名称为“赏桂品茗国粹馆”。

- 使用设备系统中文声音；首次点“试听声音”，确认媒体音量已开启。
- 确认结算后自动播报本局与累计分数、下一局庄家和老数；可关闭自动播报。
- 支持手动播报分数、庄家、起牌位置，以及重听和停止。
- 趣味效果包含胡牌红印、一老翡翠光环、二老双金环和三老金芒牌匾；页面可逐个预览，预览不记分。
- 开局页和牌局设置均保留“开启特效”开关，立即保存在本机。开启时每次结算播放，关闭后不自动播放。
- 名字与分数分行显示，长名字自动换行，三位数及更长分数不再挤占名字宽度。
- 内置四男四女共 8 款头像。开局或“改名”中点头像更换，随牌局保存；头像不需要联网下载。
- 昵称分为“杭州地名”30 项与“杭州历史名人”27 项（含林徽因、戴望舒、梁实秋），地名合并完整西湖十景、景点和街道，名人涵盖古代至民国。所有名称最多四字；可以分组点选，随机分配只从当前组抽取四个不同昵称，整桌全为地名或全为名人。
- “记录”中每局都有“修改结果”：可改胡家、胡法、承包或流局，保存后重算该局及后续分数、庄家和老数，不增加局数。
- 系统减少动态效果时显示静态版本；可手动预览特效。
- v4 使用独立牌局存储；同源第一次打开会复制一次 v3 牌局，此后独立记分。
- 手机不录音，不下载或初始化模型，不连接识别/纠错服务；无需部署后端。
- 系统声音是否联网由设备决定。实际发声与音量仍需在目标手机确认。
- 版本：2026-10-18.7-guocui-hall-v4。
`);
const archive = resolve(releaseDir, `${name}.tar.gz`);
const pending = resolve(temporary, `${name}.tar.gz`);
execFileSync('tar', ['-czf', pending, '-C', temporary, name]);
await rename(pending, archive);
console.log(`Packaged ${archive} (static page with system speech output)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

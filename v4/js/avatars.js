// Built-in vector portraits keep the single-file page usable offline.
const AVATAR_PROFILES = [
  { id: 'man-short', label: '直发男生', gender: 'male', bg: '#cce8dc', shirt: '#166553', hair: '#252b30', style: 'fringe' },
  { id: 'man-curly', label: '卷发男生', gender: 'male', bg: '#f6dfab', shirt: '#b6762d', hair: '#56392e', style: 'curly', glasses: true },
  { id: 'man-side', label: '侧分男生', gender: 'male', bg: '#cbdfe8', shirt: '#345a77', hair: '#293a48', style: 'side' },
  // Keep the saved ID so existing selections automatically use the replacement.
  { id: 'man-silver', label: '阳光男生', gender: 'male', bg: '#ffe7c2', shirt: '#d96b38', hair: '#352e2b', style: 'tousled', smile: 'bright' },
  { id: 'woman-bob', label: '短发女生', gender: 'female', bg: '#f4d4c8', shirt: '#b34e50', hair: '#45322d', style: 'bob' },
  { id: 'woman-pony', label: '马尾女生', gender: 'female', bg: '#d4e6bd', shirt: '#597b3c', hair: '#674733', style: 'pony' },
  { id: 'woman-wave', label: '卷发女生', gender: 'female', bg: '#f5dda3', shirt: '#ad692d', hair: '#8a5034', style: 'wave', glasses: true },
  { id: 'woman-bun', label: '丸子头女生', gender: 'female', bg: '#d5deef', shirt: '#5a639c', hair: '#30364b', style: 'bun' },
];

function portraitSource(profile) {
  const hairBack = {
    bob: '<path d="M22 57V40c0-35 56-35 56 0v28H22Z"/>',
    pony: '<path d="M71 31c24-8 24 30 6 41l-8-26Z"/><path d="M24 49V34c0-29 51-29 52 0v17Z"/>',
    wave: '<path d="M24 23c9-13 43-12 51 5 5 11 0 16 5 26 11 25-10 26-15 18H31c-19 11-23-8-16-21 5-10 0-20 9-28Z"/>',
    bun: '<circle cx="50" cy="17" r="14"/><path d="M25 49V36c0-30 50-30 50 0v16Z"/>',
  }[profile.style] || '';
  const hairFront = {
    fringe: '<path d="M25 44V30c0-24 50-24 50 0v14h-6v-8h-7v3h-8v-3h-7v3h-8v-3h-8v8Z"/><path d="M38 23v10m12-12v12m12-10v10" fill="none" stroke="#46504d" stroke-width="1.3" stroke-linecap="round"/>',
    curly: '<path d="M25 43V29h50v14l-8-12-9 6-12-7-12 6Z"/><circle cx="30" cy="25" r="10"/><circle cx="44" cy="19" r="11"/><circle cx="60" cy="19" r="11"/><circle cx="72" cy="27" r="10"/>',
    side: '<path d="M25 43V29c0-25 51-24 51 1v13l-9-17c-7 10-20 15-35 13l-4 8Z"/>',
    tousled: '<path d="M25 43V30c-2-9 4-16 13-17l-3-7 13 6 8-6 3 8c12 1 18 9 16 19l-2 10-7-13c-9 5-20 4-31 0l-5 13Z"/>',
    bob: '<path d="M26 44V31c5-23 49-23 49 0v15L63 29c-9 10-22 14-37 15Z"/>',
    pony: '<path d="M26 42V29c11-21 44-18 48 4v9L59 26c-8 8-18 13-33 16Z"/>',
    wave: '<path d="M25 42c-6-27 42-36 50-10l-2 13-13-17c-9 8-19 12-35 14Z"/>',
    bun: '<path d="M26 42V29c8-23 45-23 48 2v12L60 27c-8 9-19 14-34 15Z"/>',
  }[profile.style];
  const glasses = profile.glasses
    ? '<g fill="none" stroke="#34443e" stroke-width="2.2"><rect x="31" y="41" width="16" height="12" rx="5"/><rect x="53" y="41" width="16" height="12" rx="5"/><path d="M47 46h6"/></g>' : '';
  const smile = profile.smile === 'bright'
    ? '<path d="M41 59h18c-1 12-17 12-18 0Z" fill="#9b493b"/><path d="M43 59h14v3H43Z" fill="#fffdf4"/>'
    : '<path d="M43 60q7 7 14 0" fill="none" stroke="#a95e4b" stroke-width="2.4" stroke-linecap="round"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="50" fill="${profile.bg}"/>
    <g fill="${profile.hair}">${hairBack}</g>
    <path d="M12 100c0-34 76-34 76 0" fill="${profile.shirt}"/>
    <path d="M42 63v13q8 10 16 0V63" fill="#e7ac87"/>
    <circle cx="27" cy="48" r="5" fill="#f1bf98"/><circle cx="73" cy="48" r="5" fill="#f1bf98"/>
    <path d="M28 34c0-25 44-25 44 0v17c0 30-44 30-44 0Z" fill="#f6cba7"/>
    <g fill="${profile.hair}">${hairFront}</g>
    <g fill="#293c35"><circle cx="39" cy="47" r="2.3"/><circle cx="61" cy="47" r="2.3"/></g>
    <g fill="#e8a18b" opacity=".65"><ellipse cx="34" cy="55" rx="5" ry="3"/><ellipse cx="66" cy="55" rx="5" ry="3"/></g>
    ${smile}${glasses}<path d="m37 79 13 9 13-9" fill="none" stroke="#fff9e8" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const AVATARS = AVATAR_PROFILES.map((profile) => ({ ...profile, src: portraitSource(profile) }));
const DEFAULT_AVATARS = { top: 'man-short', right: 'woman-bob', bottom: 'man-curly', left: 'woman-pony' };

export function getPlayerAvatar(avatarId, seat) {
  return AVATARS.find(({ id }) => id === avatarId)
    || AVATARS.find(({ id }) => id === DEFAULT_AVATARS[seat]) || AVATARS[0];
}

// The yarnOga mark (assets/brand/yarnoga-icon.svg). Each copy on a page gets its own
// gradient ids, since a hidden copy's gradients don't paint the visible one.
export function mark(id: string, size: number): string {
  return `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 512 512" aria-hidden="true"><defs>
<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1ff9e"/><stop offset=".45" stop-color="#c6ff1f"/><stop offset="1" stop-color="#86d100"/></linearGradient>
<linearGradient id="${id}b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9f000"/><stop offset="1" stop-color="#3f9a00"/></linearGradient>
<filter id="${id}s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".45"/></filter></defs>
<g class="bubble"><path class="tail" d="M185.6 368.4 92 440l17.3-172.8Z" fill="url(#${id}b)" stroke="url(#${id}b)" stroke-width="30" stroke-linejoin="round"/>
<path d="M397 287.3a150 150 0 0 1-282 0" fill="none" stroke="url(#${id}b)" stroke-width="72" stroke-linecap="round"/>
<path class="ring" pathLength="1" d="M126.1 311a150 150 0 1 1 257.1 4.5" fill="none" stroke="url(#${id}a)" stroke-width="72" stroke-linecap="round" filter="url(#${id}s)"/></g>
<path class="y" pathLength="1" d="m208 184 48 54 48-54m-48 54v58" fill="none" stroke="#f3f4ef" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

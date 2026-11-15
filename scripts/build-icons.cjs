// Original SVG artwork. Rebuild with: node scripts/build-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '../assets/icons');
fs.mkdirSync(directory, { recursive: true });
const palettes = {
  blue: ['#b4f4ff', '#36bbee', '#1376c4'],
  purple: ['#e7cbff', '#aa76ef', '#6536b8'],
  green: ['#c4ffdf', '#57dca0', '#149875'],
  gold: ['#fff5a3', '#ffcc38', '#db8a12'],
  pink: ['#ffc4dc', '#fa658f', '#cb295a'],
  white: ['#ffffff', '#edf4ff', '#b4c9e5'],
  silver: ['#ffffff', '#d2e0f0', '#829bb8']
};
const defs = Object.entries(palettes).map(([name, colors]) => `<linearGradient id="${name}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="${colors[0]}"/><stop offset=".45" stop-color="${colors[1]}"/><stop offset="1" stop-color="${colors[2]}"/></linearGradient>`).join('') + '<filter id="shadow" x="-30%" y="-30%" width="170%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="1.3" flood-color="#253957" flood-opacity=".2"/></filter>';
const shape = (d, color, extra = '') => `<path d="${d}" fill="url(#${color})" ${extra}/>`;
const line = (d, color = '#fff', width = 3) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const rect = (x,y,w,h,r,color) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${color})"/>`;
const circle = (x,y,r,color) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${color})"/>`;
const check = line('m23 33 6 6 13-14', '#fff', 5);
const arrow = shape('M8 25h28v-8l15 13-15 13v-9H8Z', 'blue');
const document = shape('M20 7h21l12 12v35H20Q16 54 16 50V11Q16 7 20 7Z', 'blue') + shape('M16 5h22l12 12v33H16Q12 50 12 46V9Q12 5 16 5Z', 'white') + shape('M38 5v10q0 3 3 3h9Z','blue') + line('M21 27h19M21 35h19M21 43h11','#57a8d3',3);
const folder = shape('M9 16h18l6 6h22v29H9Z','gold') + rect(12,20,38,26,3,'white') + shape('M7 28q0-3 3-3h45l-5 26q-.5 3-4 3H12q-3 0-3-3Z','gold') + line('M13 29h35','#fff4bd',2);
const envelope = rect(8,16,49,35,6,'blue') + rect(5,13,49,35,6,'white') + shape('M6 16 29 34 53 16v26q0 6-6 6H12q-6 0-6-6Z','blue') + line('m8 17 21 16 22-16','#d7f8ff',2);
const clock = circle(34,33,23,'purple') + circle(30,29,23,'purple') + circle(30,29,17,'white') + line('M30 18v12l8 5','#8059b7',4) + line('M17 15a18 18 0 0 1 19-3','#fff',2);
const icons = {
  folder,
  document,
  dashboard: rect(8,8,22,22,6,'blue') + rect(35,8,22,22,6,'purple') + rect(8,35,22,22,6,'pink') + rect(35,35,22,22,6,'gold') + line('M13 13h10M40 13h10M13 40h10M40 40h10','#fff9',2),
  movement: `<g transform="translate(2 -3)">${arrow}</g><g transform="translate(62 67) rotate(180)">${arrow.replaceAll('#blue','#pink')}</g>`,
  users: circle(43,21,9,'purple') + rect(32,33,25,20,10,'purple') + circle(24,19,11,'pink') + rect(8,33,32,23,11,'pink') + line('M19 12q5-3 9 0','#ffe2ed',2) + line('M45 40v12M39 46h12','#fff',3),
  settings: shape('m26 5 13 0 2 8 6 3 8-2 6 11-6 6v6l6 6-6 11-8-2-6 3-2 8H26l-2-8-6-3-8 2-6-11 6-6v-6l-6-6 6-11 8 2 6-3Z','purple') + circle(32,33,16,'silver') + circle(32,33,10,'purple') + line('M25 9h10','#f1dcff',2),
  bell: circle(32,9,6,'gold') + circle(32,46,10,'gold') + shape('M13 35V26Q13 12 30 12q19 0 19 17v7l6 9q2 6-6 7H12q-7-1-5-6Z','gold') + `<ellipse cx="31" cy="47" rx="22" ry="5" fill="url(#gold)"/>` + line('M19 32v-8q0-6 6-7','#fff4b2',3),
  search: `<g transform="rotate(-8 32 32)">${line('M40 41 55 56','#11669f',10)}${line('M39 39 54 54','url(#blue)',8)}${circle(26,25,21,'blue')}${circle(26,25,15,'white')}${line('M16 21q2-8 10-8','#fff',3)}</g>`,
  logout: rect(28,6,26,50,5,'purple') + shape('M29 6 48 12v43L29 50Z','white') + circle(42,32,2,'gold') + `<g transform="translate(49 59) rotate(180) scale(.8)">${arrow.replaceAll('#blue','#pink')}</g>`,
  archive: rect(10,19,46,36,5,'green') + rect(6,14,46,36,5,'green') + rect(4,10,50,12,4,'green') + rect(20,29,20,9,3,'white') + line('M25 33h10','#51ad8c',2) + line('M10 13h37','#d1ffea',2),
  mail: envelope,
  sent: envelope + `<g transform="translate(32 32) scale(.52)">${arrow.replaceAll('#blue','#pink')}</g>`,
  school: rect(12,21,43,34,3,'blue') + rect(8,18,43,34,3,'white') + shape('M4 22 29 5 55 22 51 27 29 13 8 27Z','pink') + rect(25,34,10,18,2,'blue') + rect(13,29,7,7,1,'blue') + rect(39,29,7,7,1,'blue'),
  education: shape('M15 29v15q16 12 32 0V29Z','purple') + shape('M3 23 32 8 61 23 32 39Z','blue') + line('m32 23 22 7v17','#ffce54',3) + circle(54,48,3,'gold'),
  history: clock,
  calendar: rect(11,12,45,44,5,'silver') + rect(7,9,45,44,5,'white') + shape('M12 9h35q5 0 5 5v10H7V14q0-5 5-5Z','blue') + line('M18 6v10M41 6v10','url(#silver)',5) + line('m20 36 7 7 15-16','#268dd3',5),
  edit: `<g transform="rotate(38 32 32)">${rect(24,6,17,43,4,'gold')}${rect(24,6,17,11,4,'pink')}${rect(24,16,17,5,1,'silver')}${shape('M24 48h17l-8 12Z','white')}${shape('m29 55 8 0-4 5Z','purple')}${line('M28 24v20','#fff4b4',2)}</g>`,
  delete: shape('M14 19h36l-3 34q0 3-4 3H21q-4 0-4-3Z','pink') + rect(23,5,17,13,4,'pink') + rect(10,14,45,8,3,'pink') + line('M25 29v18M38 29v18','#ffd4e1',3) + line('M15 17h34','#ffd4e1',2),
  shield: shape('M33 5 56 14v17q-2 19-23 28Q12 50 10 31V14Z','green') + shape('M29 4 51 13v16q-2 19-22 27Q9 48 7 29V13Z','blue') + check,
  complete: circle(34,34,24,'green') + circle(30,30,24,'green') + check + line('M14 18q5-8 14-8','#dcffec',2),
  pending: clock.replaceAll('#purple','#gold'),
  received: rect(7,26,49,28,5,'green') + `<g transform="translate(13 -1) scale(.65)">${document}</g>` + shape('M7 36h14l4 7h14l4-7h13v14q0 4-4 4H11q-4 0-4-4Z','green'),
  returned: `<g transform="translate(61 62) rotate(180)">${arrow.replaceAll('#blue','#gold')}</g>`,
  filter: rect(8,10,48,10,5,'blue') + rect(16,27,32,10,5,'purple') + rect(25,44,14,10,5,'pink'),
  back: shape('M39 7 14 30q-3 3 0 6l25 22 8-10-18-15 18-16Z','blue'),
  close: circle(33,34,24,'pink') + circle(30,30,24,'pink') + line('m22 22 16 16M38 22 22 38','#fff',5),
  eye: shape('M4 32q28-36 56 0Q32 68 4 32Z','white') + circle(32,32,14,'blue') + circle(32,32,7,'purple') + circle(28,27,4,'white'),
  rocket: shape('M19 35 8 40 5 54l18-7M37 43l-1 14 14-8 2-15','purple') + shape('M16 43q-8 3-9 16 13-1 17-10Z','gold') + shape('M18 33Q31 6 55 6q4 25-23 42Z','white') + circle(40,22,9,'blue') + circle(40,22,5,'purple') + line('m22 36 10 10','#f674a3',5)
};
icons['eye-off'] = icons.eye + line('m10 10 44 44','url(#pink)',6);
for (const [name, body] of Object.entries(icons)) {
  fs.writeFileSync(path.join(directory, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs><g filter="url(#shadow)">${body}</g></svg>\n`);
}
console.log(`Built ${Object.keys(icons).length} dimensional icons.`);

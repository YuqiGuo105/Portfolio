// QR codes, made in the browser (or on the server for a page that is rendered there): no request
// leaves the visitor's device to draw one.
import qrcode from 'qrcode-generator';

// Addresses are encoded as UTF-8, so a link with non-Latin text in it still scans correctly.
qrcode.stringToBytes = text => Array.from(new TextEncoder().encode(text));

// level: L, M, Q or H. M is right for a screen; Q survives a printed card or a photo of a screen.
export function qrMatrix(text, level = 'M') {
  const code = qrcode(0, level);
  code.addData(String(text));
  code.make();
  const size = code.getModuleCount();
  return { size, dark: (row, column) => code.isDark(row, column) };
}

// One SVG path for all dark modules; `quiet` is the blank margin, in modules.
export function qrPath(text, { level = 'M', quiet = 2 } = {}) {
  const { size, dark } = qrMatrix(text, level);
  let d = '';
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!dark(row, column)) continue;
      let run = 1;
      while (column + run < size && dark(row, column + run)) run += 1;
      d += `M${column + quiet} ${row + quiet}h${run}v1h-${run}z`;
      column += run - 1;
    }
  }
  return { d, size: size + quiet * 2 };
}

export function qrSvg(text, { level = 'M', quiet = 2, color = '#1c2528', background = '#ffffff', title = 'QR code' } = {}) {
  const { d, size } = qrPath(text, { level, quiet });
  const safe = String(title).replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${safe}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${background}"/><path d="${d}" fill="${color}"/></svg>`;
}

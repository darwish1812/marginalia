// Rasterise the maskable mark with the same engine the booklet runs in, and check that
// nothing that matters falls outside the safe circle the launcher will crop to.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('icon-maskable.svg', 'utf8');
const SIZE = 512;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await p.setContent(`<style>html,body{margin:0;padding:0}svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>${svg}`);
writeFileSync('icon-512-maskable.png', await p.screenshot({ omitBackground: false }));

// Every drawn corner, measured against the safe radius (40% of the width).
const report = await p.evaluate((SIZE) => {
  const safe = SIZE * 0.4, c = SIZE / 2;
  const out = [];
  for (const r of document.querySelectorAll('g rect')) {
    const box = r.getBoundingClientRect();
    for (const [x, y] of [[box.left, box.top], [box.right, box.top], [box.left, box.bottom], [box.right, box.bottom]])
      out.push(Math.hypot(x - c, y - c));
  }
  return { safe, worst: Math.max(...out), everyCornerInside: Math.max(...out) <= safe };
}, SIZE);
console.log(JSON.stringify(report, null, 1));
await b.close();

import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;
const YEAR_RE  = /^\d{4}$/;

const TOTAL_KW = ["total","net profit","gross profit","operating profit",
  "profit before tax","profit after tax","ebitda","net income","net loss","profit before"];

// Only skip structural/formatting non-data rows
const SKIP_RE = /^(consolidated|standalone|rs\.?\s*crore|particulars|description|view standalone|figures in)/i;

const SECTION_MAP = {
  Revenue:     ["sales","revenue","turnover","income from operation"],
  Expenses:    ["expense","cost of","depreciation","amortization","interest"],
  Profit:      ["profit","ebitda","ebit","other income","earnings"],
  Assets:      ["asset","investment","receivable","inventory","cash and"],
  Liabilities: ["liabilit","borrowing","payable","provision"],
  Equity:      ["equity","retained earning","reserve","share capital"]
};

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE PREPROCESSING — runs before OCR for max accuracy
// ─────────────────────────────────────────────────────────────────────────────
async function preprocessImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      // Scale up 2× — Tesseract accuracy improves significantly at higher res
      const SCALE = img.width < 2000 ? 2.5 : 1.5;
      const W = Math.round(img.width  * SCALE);
      const H = Math.round(img.height * SCALE);

      const canvas = document.createElement("canvas");
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      // High-quality scaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, W, H);

      const imageData = ctx.getImageData(0, 0, W, H);
      const d = imageData.data;
      const n = d.length;

      // ── 1. Grayscale (luminance-weighted) ──────────────────────────────────
      const gray = new Uint8ClampedArray(W * H);
      for (let i = 0, p = 0; i < n; i += 4, p++) {
        gray[p] = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
      }

      // ── 2. Shadow removal — subtract estimated background using block means ─
      const BLK = 64; // block size
      const bw = Math.ceil(W / BLK), bh = Math.ceil(H / BLK);
      const bg = new Float32Array(bw * bh);
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          let sum = 0, cnt = 0;
          for (let y = by*BLK; y < Math.min((by+1)*BLK, H); y++) {
            for (let x = bx*BLK; x < Math.min((bx+1)*BLK, W); x++) {
              sum += gray[y*W+x]; cnt++;
            }
          }
          bg[by*bw+bx] = cnt ? sum/cnt : 128;
        }
      }
      const bgInterp = (px, py) => {
        const bx = px/BLK, by = py/BLK;
        const x0=Math.min(Math.floor(bx),bw-1), x1=Math.min(x0+1,bw-1);
        const y0=Math.min(Math.floor(by),bh-1), y1=Math.min(y0+1,bh-1);
        const fx=bx-x0, fy=by-y0;
        return bg[y0*bw+x0]*(1-fx)*(1-fy)+bg[y0*bw+x1]*fx*(1-fy)+
               bg[y1*bw+x0]*(1-fx)*fy+bg[y1*bw+x1]*fx*fy;
      };
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y*W+x;
          const v = Math.round(gray[p] - bgInterp(x,y) + 200);
          gray[p] = Math.max(0, Math.min(255, v));
        }
      }

      // ── 3. Contrast normalisation (percentile stretch 2%–98%) ─────────────
      const hist = new Int32Array(256);
      for (let p = 0; p < gray.length; p++) hist[gray[p]]++;
      const total = W * H;
      let lo = 0, loC = 0;
      while (loC < total * 0.02) loC += hist[lo++];
      let hi = 255, hiC = 0;
      while (hiC < total * 0.02) hiC += hist[hi--];
      const rng = hi - lo || 1;
      for (let p = 0; p < gray.length; p++) {
        gray[p] = Math.max(0, Math.min(255, Math.round((gray[p]-lo)/rng*255)));
      }

      // ── 4. Sharpening — unsharp mask (amount=1.5, radius=1) ───────────────
      const blurred = new Uint8ClampedArray(gray.length);
      for (let y = 1; y < H-1; y++) {
        for (let x = 1; x < W-1; x++) {
          const p = y*W+x;
          blurred[p] = Math.round(
            (gray[(y-1)*W+(x-1)]+gray[(y-1)*W+x]*2+gray[(y-1)*W+(x+1)] +
             gray[y*W+(x-1)]*2   +gray[p]*4           +gray[y*W+(x+1)]*2 +
             gray[(y+1)*W+(x-1)]+gray[(y+1)*W+x]*2+gray[(y+1)*W+(x+1)]) / 16
          );
        }
      }
      const AMOUNT = 1.4;
      for (let p = 0; p < gray.length; p++) {
        gray[p] = Math.max(0, Math.min(255, Math.round(gray[p] + AMOUNT*(gray[p]-blurred[p]))));
      }

      // ── 5. Write back to RGBA ──────────────────────────────────────────────
      for (let i = 0, p = 0; i < n; i += 4, p++) {
        d[i] = d[i+1] = d[i+2] = gray[p]; d[i+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(new File([blob], file.name.replace(/\.\w+$/, ".png"), { type: "image/png" }));
      }, "image/png");
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TSV PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseTSV(tsv) {
  if (!tsv) return [];
  return tsv.split("\n").flatMap(line => {
    const c = line.split("\t");
    if (c.length < 12 || Number(c[0]) !== 5) return [];
    const text = c.slice(11).join("\t").trim();
    if (!text) return [];
    const l=Number(c[6]), t=Number(c[7]), w=Number(c[8]), h=Number(c[9]);
    return [{ text, conf: Number(c[10]), bbox: { x0:l, y0:t, x1:l+w, y1:t+h } }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const safeParse = t => { const n=parseFloat((t||"").replace(/[,%]/g,"")); return isNaN(n)?null:n; };
const classify  = l => { const lo=l.toLowerCase(); return TOTAL_KW.some(k=>lo.includes(k))?"total":lo.startsWith("sub-total")||lo.startsWith("subtotal")?"subtotal":"line_item"; };
const getSection= l => { const lo=l.toLowerCase(); for(const[s,kws]of Object.entries(SECTION_MAP)) if(kws.some(k=>lo.includes(k))) return s; return null; };
const stmtType  = txt => { const l=txt.toLowerCase(); if(["balance sheet","assets","liabilities","equity"].filter(k=>l.includes(k)).length>=2) return "Balance Sheet"; if(["cash flow","operating activities","financing activities"].some(k=>l.includes(k))) return "Cash Flow"; return "Profit & Loss"; };
const extractUnit = txt => { const m=txt.match(/figures?\s+in\s+[^
.]+|in\s+rs\.?\s*\w+|rs\.?\s*(?:in\s+)?(?:crore|lakh|million|billion)[s]?(?:\s*\(.*?\))?/i); return m ? m[0].trim() : null; };

// ─────────────────────────────────────────────────────────────────────────────
// TABLE RECONSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────
function toRows(words, yTol=10) {
  const rows=[];
  for(const w of [...words].sort((a,b)=>a.bbox.y0-b.bbox.y0)) {
    const cy=(w.bbox.y0+w.bbox.y1)/2;
    const row=rows.find(r=>Math.abs(r.cy-cy)<yTol);
    if(row){row.words.push(w);row.cy=row.words.reduce((s,x)=>s+(x.bbox.y0+x.bbox.y1)/2,0)/row.words.length;}
    else rows.push({cy,words:[w]});
  }
  rows.forEach(r=>r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0));
  return rows;
}

function detectCols(rows) {
  for(let ri=0;ri<rows.length;ri++) {
    const ws=rows[ri].words;
    if(!ws.some(w=>MONTH_RE.test(w.text))) continue;

    const cols=[];
    let lastColEndIdx=-1;

    for(let i=0;i<ws.length;i++) {
      if(MONTH_RE.test(ws[i].text)&&ws[i+1]&&YEAR_RE.test(ws[i+1].text)) {
        cols.push({header:`${ws[i].text} ${ws[i+1].text}`,cx:(ws[i].bbox.x0+ws[i+1].bbox.x1)/2});
        lastColEndIdx=i+1; i++;
      } else if(/^T+M[.,:]?$/i.test(ws[i].text.trim())) {
        // catches TTM, TIM, TTW etc. (OCR misreads)
        cols.push({header:"TTM",cx:(ws[i].bbox.x0+ws[i].bbox.x1)/2});
        lastColEndIdx=i;
      }
    }

    if(cols.length<2) continue;

    // If no TTM detected, check for any leftover word(s) after the last year
    if(!cols.find(c=>c.header==="TTM")) {
      const spacing=(cols[cols.length-1].cx-cols[0].cx)/Math.max(cols.length-1,1);
      const extraWords=ws.filter(w=>{
        const cx=(w.bbox.x0+w.bbox.x1)/2;
        return cx>cols[cols.length-1].cx+spacing*0.4 && w.text.trim().length>0;
      });
      if(extraWords.length>0) {
        // Use the word closest to expected TTM position
        const expectedCx=cols[cols.length-1].cx+spacing;
        const best=extraWords.sort((a,b)=>
          Math.abs((a.bbox.x0+a.bbox.x1)/2-expectedCx)-Math.abs((b.bbox.x0+b.bbox.x1)/2-expectedCx)
        )[0];
        cols.push({header:"TTM",cx:(best.bbox.x0+best.bbox.x1)/2});
      } else {
        // Extrapolate TTM column position even if header not visible
        cols.push({header:"TTM",cx:cols[cols.length-1].cx+spacing});
      }
    }

    return {hri:ri,cols};
  }
  return null;
}

function assign(rowWords, cols, cutX) {
  const span=cols[cols.length-1].cx-cols[0].cx;
  const tol=Math.max(50,(span/Math.max(cols.length-1,1))*0.75);
  const res=cols.map(()=>null), used=new Set();
  for(const w of rowWords) {
    const cx=(w.bbox.x0+w.bbox.x1)/2;
    if(cx<cutX-5) continue;
    const isPct = w.text.includes("%");
    // For % values keep as string ("31%"), for others parse as number
    const n = isPct ? safeParse(w.text.replace(/%/g,"")) : safeParse(w.text);
    if(n===null) continue;
    const val = isPct ? n+"%" : n;
    let best=-1,bd=tol;
    cols.forEach((c,i)=>{if(!used.has(i)){const d=Math.abs(cx-c.cx);if(d<bd){bd=d;best=i;}}});
    if(best>=0){res[best]=val;used.add(best);}
  }
  return res;
}


// Merge fragments like ['79,','809'] → one word '79,809' at merged position
function mergeNumberFragments(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i+1];
    // If current ends with comma and next is digits, merge them
    if (/^-?[\d,]*\d,$/.test(w.text) && next && /^\d+$/.test(next.text)) {
      out.push({ text: w.text + next.text, conf: Math.min(w.conf, next.conf),
        bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: next.bbox.x1, y1: next.bbox.y1 } });
      i++; // skip next
    } else {
      out.push(w);
    }
  }
  return out;
}

function buildTable(words, text) {
  if(!words.length) return null;
  const rows=toRows(words);
  const ci=detectCols(rows);
  if(!ci||ci.cols.length<2) return null;
  const {hri,cols}=ci;
  const cutX=cols[0].cx-(cols[1]?(cols[1].cx-cols[0].cx)*0.5:60);
  let section="General";
  const trows=[];

  for(let ri=0;ri<rows.length;ri++) {
    if(ri<=hri) continue;
    const rw=rows[ri].words;
    if(!rw.length) continue;

    const label=rw.filter(w=>(w.bbox.x0+w.bbox.x1)/2<cutX)
      .map(w=>w.text).join(" ").replace(/[+*©®™|<>:]+$/,"").replace(/\s+/g," ").trim();

    if(!label||label.length<2||/^\d+$/.test(label)||SKIP_RE.test(label)) continue;

    const mergedRw = mergeNumberFragments(rw);
    const vals=assign(mergedRw,cols,cutX);
    if(!vals.some(v=>v!==null)) continue;

    const sec=getSection(label);
    if(sec) section=sec;

    trows.push({id:crypto.randomUUID(),label,section,
      row_type:classify(label),values:vals,
      amount:[...vals].reverse().find(v=>v!==null)??0,
      level:1,confidence:0.9,issues:[]});
  }
  return trows.length?{columns:cols.map(c=>c.header),rows:trows}:null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: processImages
// ─────────────────────────────────────────────────────────────────────────────
export async function processImages(files, onProgress) {
  const worker = await createWorker("eng", 1, {
    logger: m => { if(m.status==="recognizing text") onProgress?.(Math.round(m.progress*100)); }
  });

  const all = [];

  for(const file of files) {
    // Advanced preprocessing
    onProgress?.(-1); // signal preprocessing stage
    const processed = await preprocessImage(file);
    const url = URL.createObjectURL(processed);
    try {
      const {data} = await worker.recognize(url, {}, {text:true,tsv:true});
      const text  = data?.text||"";
      const words = parseTSV(data?.tsv||"");
      const td    = words.length ? buildTable(words,text) : null;

      if(td&&td.rows.length>0) {
        all.push({id:crypto.randomUUID(),statement_type:stmtType(text),unit:extractUnit(text)||"Figures in Rs. Crores",rows:td.rows,tableData:td});
      } else {
        throw new Error("Could not detect a financial table. Ensure the screenshot includes the full header row with column years.");
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  await worker.terminate();
  if(!all.length) throw new Error("No financial data extracted.");
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: exportToExcel
// ─────────────────────────────────────────────────────────────────────────────
export function exportToExcel(statements) {
  const wb = XLSX.utils.book_new();
  for(const stmt of statements) {
    const td=stmt.tableData;
    const yrs=td?td.columns:["Amount (₹ Cr)"];
    const hdr=["Line Item",...yrs];
    const body=(td?td.rows:stmt.rows).map(r=>[r.label,...(td?r.values.map(v=>v??[]):[r.amount])]);
    const ws=XLSX.utils.aoa_to_sheet([hdr,...body]);
    ws["!cols"]=[{wch:28},...yrs.map(()=>({wch:11}))];
    XLSX.utils.book_append_sheet(wb,ws,stmt.statement_type.substring(0,31));
  }
  XLSX.writeFile(wb,"financials-export.xlsx");
}

import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_RE = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)$/i;
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
      // Scale up — 3× for small images (better header detection)
      const SCALE = img.width < 1200 ? 3.0 : img.width < 2000 ? 2.5 : 1.5;
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

      // ── 0. Color-aware normalisation ──────────────────────────────────────
      // For colored-background pixels (e.g. red column headers with white text):
      // use min(R,G,B) for dark-text regions, and 255-max(R,G,B) for colored-bg
      // pixels so that white-on-red → dark-on-light, readable by Tesseract.
      // Also track which pixels were colored so we can skip shadow removal there.
      const isColored = new Uint8Array(W * H); // 1 = was a saturated colored bg pixel
      for (let i = 0, p = 0; i < n; i += 4, p++) {
        const r = d[i], g = d[i+1], b = d[i+2];
        const minCh = Math.min(r, g, b);
        const maxCh = Math.max(r, g, b);
        if (maxCh - minCh > 60 && maxCh < 245) {
          // Saturated pixel: colored background (red, blue, green header, etc.)
          // Map to grayscale using min channel: dark ink on any bg stays dark.
          // For the bg itself: min-channel will be low (e.g. red bg: min~45 → dark).
          // For white text on colored bg: min~255 → stays white.
          // This gives white-on-dark which Tesseract can read after we invert below.
          const v = 255 - maxCh; // invert the dominant channel: colored bg → near-black
          d[i] = d[i+1] = d[i+2] = v;
          isColored[p] = 1;
        }
        // else: leave normal light-bg pixels unchanged for standard grayscale
      }

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
          if (isColored[p]) continue; // skip shadow removal for colored-bg pixels — they are already contrast-corrected
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
const extractUnit = txt => { const m = txt.match(/(?:Consolidated )?Figures in Rs\.? \w+/i); return m ? m[0].trim() : 'Rs. Crores'; };

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
    // Detect Note column X position from header row
    let noteX=null;
    for(let i=0;i<ws.length;i++) {
      if(/^note$/i.test(ws[i].text)) {
        noteX=(ws[i].bbox.x0+ws[i].bbox.x1)/2;
      } else if(/^no\.?$/i.test(ws[i].text)&&i>0&&/^note$/i.test(ws[i-1].text)) {
        noteX=(ws[i-1].bbox.x0+ws[i].bbox.x1)/2;
      }
    }

    for(let i=0;i<ws.length;i++) {
      if(MONTH_RE.test(ws[i].text)) {
        // "Month YYYY" — 2-token (e.g. "Mar 2024")
        if(ws[i+1]&&YEAR_RE.test(ws[i+1].text)) {
          cols.push({header:`${ws[i].text} ${ws[i+1].text}`,cx:(ws[i].bbox.x0+ws[i+1].bbox.x1)/2});
          i++;
        }
        // "Month DD[,] YYYY" — 3-token (e.g. "March 31, 2025") — day may have trailing comma
        else if(ws[i+1]&&ws[i+2]&&YEAR_RE.test(ws[i+2].text.replace(/[,.]$/,""))) {
          const yearText=ws[i+2].text.replace(/[,.]$/,"");
          cols.push({header:`${ws[i].text} ${yearText}`,cx:(ws[i].bbox.x0+ws[i+2].bbox.x1)/2});
          i+=2;
        }
        // "Month DD , YYYY" — 4-token (OCR splits comma separately)
        else if(ws[i+1]&&ws[i+2]&&ws[i+3]&&YEAR_RE.test(ws[i+3].text.replace(/[,.]$/,""))) {
          const yearText=ws[i+3].text.replace(/[,.]$/,"");
          cols.push({header:`${ws[i].text} ${yearText}`,cx:(ws[i].bbox.x0+ws[i+3].bbox.x1)/2});
          i+=3;
        }
      } else if(/^T+M[.,:]?$|^(TTM|LTM)$/i.test(ws[i].text.trim())) {
        // catches TTM, TIM, TTW etc. (OCR misreads), also LTM
        cols.push({header:"TTM",cx:(ws[i].bbox.x0+ws[i].bbox.x1)/2});
      }
    }

    if(cols.length<2) continue;

    // Only add TTM if there's explicit evidence (don't extrapolate for Balance Sheets etc.)
    if(!cols.find(c=>c.header==="TTM")) {
      const spacing=(cols[cols.length-1].cx-cols[0].cx)/Math.max(cols.length-1,1);
      const extraWords=ws.filter(w=>{
        const cx=(w.bbox.x0+w.bbox.x1)/2;
        return cx>cols[cols.length-1].cx+spacing*0.4 && w.text.trim().length>0;
      });
      // Only add TTM if the extra word explicitly looks like a TTM header
      const ttmWord=extraWords.find(w=>/^(TTM|LTM|T\.T\.M\.?|9M|6M|3M)$/i.test(w.text.trim()));
      if(ttmWord) {
        cols.push({header:"TTM",cx:(ttmWord.bbox.x0+ttmWord.bbox.x1)/2});
      }
    }

    return {hri:ri,cols,noteX};
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
  const {hri,cols,noteX}=ci;
  const cutX=cols[0].cx-(cols[1]?(cols[1].cx-cols[0].cx)*0.5:60);
  let section="General";
  const trows=[];

  for(let ri=0;ri<rows.length;ri++) {
    if(ri<=hri) continue;
    const rw=rows[ri].words;
    if(!rw.length) continue;

    const label=rw.filter(w=>(w.bbox.x0+w.bbox.x1)/2<cutX)
      .map(w=>w.text).join(" ").replace(/[+*©®™|<>:]+$/,"").replace(/\s+/g," ").trim();

    if(!label||label.length<2||/^[\d\s,.()\-]+$/.test(label)||SKIP_RE.test(label)) continue;

    const mergedRw = mergeNumberFragments(rw);
    const vals=assign(mergedRw,cols,cutX);

    // Extract note number: short digit token near noteX (between label zone and first value col)
    let note=null;
    if(noteX) {
      const noteTol=40;
      const noteCandidate=rw.find(w=>{
        const cx=(w.bbox.x0+w.bbox.x1)/2;
        return Math.abs(cx-noteX)<noteTol && /^\d{1,2}[A-Z]?$/.test(w.text.trim());
      });
      if(noteCandidate) note=noteCandidate.text.trim();
    }

    // Detect ALL CAPS section headers (e.g. "NON-CURRENT ASSETS", "EQUITY AND LIABILITIES")
    const isAllCaps=label.length>3&&label===label.toUpperCase()&&/[A-Z]/.test(label);

    // Keep row if it has values OR it's a section header
    if(!vals.some(v=>v!==null)&&!isAllCaps) continue;

    const sec=getSection(label);
    if(sec) section=sec;

    const rowType=isAllCaps?"header":classify(label);
    const is_bold=isAllCaps||rowType==="total"||rowType==="subtotal";

    trows.push({id:crypto.randomUUID(),label,section,note,is_bold,
      row_type:rowType,values:vals,
      amount:[...vals].reverse().find(v=>v!==null)??0,
      level:1,confidence:0.9,issues:[]});
  }
  return trows.length?{columns:cols.map(c=>c.header),rows:trows}:null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: processImages
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GEMINI VISION FALLBACK
// ─────────────────────────────────────────────────────────────────────────────
async function extractWithGemini(file) {
  try {
    // Get Gemini key from config endpoint
    const cfgRes = await fetch("/api/config");
    if (!cfgRes.ok) return null;
    const { geminiKey } = await cfgRes.json();
    if (!geminiKey) return null;

    // Convert file to base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const prompt = `Extract the financial table from this image. Return ONLY valid JSON (no markdown):
{"columns":["Mar 2025","Mar 2024"],"rows":[{"label":"NON-CURRENT ASSETS","note":null,"values":[null,null],"is_bold":true,"row_type":"header"},{"label":"Property, Plant & Equipment","note":"1","values":[40563.52,34436.76],"is_bold":false,"row_type":"line_item"}]}
Rules: columns=year headers; note=note number string or null; values=numbers per column (null if blank, no commas); is_bold=true for ALL-CAPS headers/totals/subtotals; row_type=header|total|subtotal|line_item. Include ALL rows.`;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        signal: ctrl.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: file.type || "image/png", data: base64 } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8192 },
        }),
      }
    );
    clearTimeout(timeout);
    if (!r.ok) return null;
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed.columns || !parsed.rows) return null;

    return {
      columns: parsed.columns,
      rows: parsed.rows.map(r => ({
        id: crypto.randomUUID(), label: r.label || "", section: "General",
        note: r.note || null, is_bold: !!r.is_bold, row_type: r.row_type || "line_item",
        values: r.values || [], amount: (r.values||[]).find(v=>v!==null)??0,
        level: 1, confidence: 0.95, issues: []
      }))
    };
  } catch(e) {
    console.error("[Gemini fallback error]", e);
    return null;
  }
}

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
        // OCR failed — fallback to Gemini Vision
        const geminiResult = await extractWithGemini(file);
        if(geminiResult&&geminiResult.rows&&geminiResult.rows.length>0) {
          all.push({id:crypto.randomUUID(),statement_type:stmtType(geminiResult.rows.map(r=>r.label).join(" ")),unit:"Figures in Rs. Lacs",rows:geminiResult.rows,tableData:geminiResult});
        } else {
          throw new Error("Could not detect a financial table. Ensure the screenshot includes the full header row with column years.");
        }
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
    const hasNote=td&&td.rows.some(r=>r.note);
    const hdr=hasNote?["Line Item","Note",...yrs]:["Line Item",...yrs];
    const body=(td?td.rows:stmt.rows).map(r=>{
      const vals=td?r.values.map(v=>v??[]):[r.amount];
      return hasNote?[r.label,r.note||"",...vals]:[r.label,...vals];
    });
    const unitRow=stmt.unit?[[stmt.unit,...Array(hdr.length-1).fill("")]]:[]; 
    const ws=XLSX.utils.aoa_to_sheet([...unitRow,hdr,...body]);

    // Bold formatting for header/total/section rows
    const dataStartRow=unitRow.length+1; // 0-indexed: unitRow + header row
    (td?td.rows:stmt.rows).forEach((r,ri)=>{
      if(!r.is_bold) return;
      const excelRow=dataStartRow+ri;
      hdr.forEach((_,ci)=>{
        const ref=XLSX.utils.encode_cell({r:excelRow,c:ci});
        if(ws[ref]) ws[ref].s={font:{bold:true}};
        else ws[ref]={t:"z",s:{font:{bold:true}}};
      });
    });

    const noteCol=hasNote?[{wch:8}]:[];
    ws["!cols"]=[{wch:30},...noteCol,...yrs.map(()=>({wch:13}))];
    XLSX.utils.book_append_sheet(wb,ws,stmt.statement_type.substring(0,31));
  }
  XLSX.writeFile(wb,"financials-export.xlsx",{cellStyles:true});
}

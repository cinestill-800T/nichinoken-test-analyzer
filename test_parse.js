const fs = require('fs');
const { JSDOM } = require('jsdom');

const filePath = process.argv[2] || '分野別正答率｜MY NICHINOKEN.mhtml';
let mhtml = fs.readFileSync(filePath, 'utf8');

// Quoted-printable decoding since mhtml is quoted-printable encoded
function decodeQuotedPrintable(str) {
    return str.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });
}
let decoded = decodeQuotedPrintable(mhtml);

const dom = new JSDOM(decoded);
const document = dom.window.document;

const contentJs = fs.readFileSync('content.js', 'utf8');
// remove the chrome.runtime block
const cleanJs = contentJs.replace(/chrome\.runtime[\s\S]*?\}\);/m, '');

// Evaluate the functions so they exist globally
eval(cleanJs);

try {
  const result = scrapeFieldAccuracyRate(document);
  console.log(JSON.stringify(result, null, 2));
} catch(e) {
  console.error("Error:", e);
}

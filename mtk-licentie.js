#!/usr/bin/env node
/**
 * tools/licentie/mtk-licentie.js — licentiecodes voor MTK maken (los van MTK zelf).
 *
 * Een code is een met Ed25519 ondertekende verklaring: "installatie X mag MTK gebruiken
 * tot datum Y". MTK controleert de handtekening met de openbare sleutel die in
 * services/licenseToken.js staat; alleen wie de geheime sleutel heeft kan codes maken.
 *
 * Opdrachten:
 *   sleutel   [--map DIR]                       nieuw sleutelpaar (weigert te overschrijven)
 *   code      --id ID [--dagen 30 | --tot JJJJ-MM-DD]   één code maken (voor plakken of mailen)
 *   intrekken --id ID                            code die meteen verlopen is (de nieuwste code wint)
 *   bestand   [--installaties installaties.json] [--uit licentie.json]
 *                                                licentie.json maken voor alle installaties (GitHub)
 *   lees      CODE                               inhoud van een code tonen (en handtekening controleren)
 *
 * Geheime sleutel: --sleutel PAD, anders omgevingsvariabele MTK_LICENTIE_SLEUTEL (de PEM-tekst
 * zelf, zo gebruikt GitHub Actions hem), anders ~/.mtk-licentie/prive.pem.
 *
 * Alleen ingebouwde Node-modules (Node 18+), zodat het overal draait zonder npm install.
 */
'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const PREFIX       = 'MTK1';
const DAG_MS       = 86_400_000;
const STANDAARD_MAP = path.join(os.homedir(), '.mtk-licentie');

// ── Hulpjes ──────────────────────────────────────────────────────────────────
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

function stop(msg) { console.error('Fout: ' + msg); process.exit(1); }

function geheimeSleutel(opt) {
  let pem;
  if (opt.sleutel) pem = fs.readFileSync(opt.sleutel, 'utf8');
  else if (process.env.MTK_LICENTIE_SLEUTEL) pem = process.env.MTK_LICENTIE_SLEUTEL;
  else {
    const p = path.join(STANDAARD_MAP, 'prive.pem');
    if (!fs.existsSync(p)) stop(`geen geheime sleutel gevonden (${p}). Gebruik --sleutel of MTK_LICENTIE_SLEUTEL.`);
    pem = fs.readFileSync(p, 'utf8');
  }
  const key = crypto.createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') stop('de sleutel is geen Ed25519-sleutel');
  return key;
}

function openbaarVan(privKey) {
  return crypto.createPublicKey(privKey).export({ type: 'spki', format: 'der' }).toString('base64');
}

function maakCode(privKey, { id, uit, tot }) {
  if (!/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/.test(id)) stop(`ongeldig installatie-ID "${id}" (verwacht xxxx-xxxx-xxxx-xxxx)`);
  const payload = { v: 1, id, uit: new Date(uit).toISOString(), tot: new Date(tot).toISOString() };
  const p64 = b64url(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(`${PREFIX}.${p64}`), privKey);
  return `${PREFIX}.${p64}.${b64url(sig)}`;
}

function totVan(opt, nu) {
  if (opt.tot) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opt.tot)) stop('--tot moet JJJJ-MM-DD zijn');
    const t = new Date(`${opt.tot}T23:59:59Z`).getTime();
    if (!(t > nu)) stop('--tot ligt in het verleden');
    return t;
  }
  const dagen = opt.dagen === undefined ? 30 : Number(opt.dagen);
  if (!(dagen > 0 && dagen <= 3660)) stop('--dagen moet tussen 1 en 3660 liggen');
  return nu + dagen * DAG_MS;
}

// ── Opdrachten ───────────────────────────────────────────────────────────────
function cmdSleutel(opt) {
  const map  = opt.map ? path.resolve(opt.map) : STANDAARD_MAP;
  const priv = path.join(map, 'prive.pem');
  const pub  = path.join(map, 'openbaar.txt');
  if (fs.existsSync(priv)) stop(`${priv} bestaat al — een nieuwe sleutel maakt alle bestaande codes waardeloos. Verwijder hem zelf als je dat echt wilt.`);
  fs.mkdirSync(map, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  fs.writeFileSync(pub, pubB64 + '\n');
  console.log(`Geheime sleutel: ${priv}  (maak hier een reservekopie van; nooit in git of chat)`);
  console.log(`Openbare sleutel (voor services/licenseToken.js): ${pubB64}`);
}

function cmdCode(opt) {
  if (!opt.id) stop('--id ontbreekt');
  const key = geheimeSleutel(opt);
  const nu  = Date.now();
  const tot = totVan(opt, nu);
  console.log(maakCode(key, { id: String(opt.id).toLowerCase(), uit: nu, tot }));
  console.error(`Geldig tot ${new Date(tot).toISOString()} voor installatie ${opt.id}`);
}

function cmdIntrekken(opt) {
  if (!opt.id) stop('--id ontbreekt');
  const key = geheimeSleutel(opt);
  const nu  = Date.now();
  console.log(maakCode(key, { id: String(opt.id).toLowerCase(), uit: nu, tot: nu }));
  console.error('Intrekcode: zodra MTK deze ontvangt is de licentie direct verlopen (nieuwste code wint).');
}

function cmdBestand(opt) {
  const bron = path.resolve(opt.installaties || 'installaties.json');
  const doel = path.resolve(opt.uit || 'licentie.json');
  const lijst = JSON.parse(fs.readFileSync(bron, 'utf8'));
  if (!Array.isArray(lijst)) stop(`${bron} moet een lijst zijn`);
  const key = geheimeSleutel(opt);
  const nu  = Date.now();
  const codes = {};
  for (const inst of lijst) {
    const id = String(inst.id || '').toLowerCase();
    if (!id) stop('installatie zonder id in ' + bron);
    if (codes[id]) stop('dubbel id ' + id);
    const actief = inst.actief !== false;
    const tot = actief ? totVan({ dagen: inst.dagen ?? 30 }, nu) : nu;   // niet actief = intrekcode
    codes[id] = maakCode(key, { id, uit: nu, tot });
    console.error(`${id}  ${actief ? 'geldig tot ' + new Date(tot).toISOString() : 'INGETROKKEN'}`);
  }
  const inhoud = { versie: 1, bijgewerkt: new Date(nu).toISOString(), codes };
  fs.writeFileSync(doel, JSON.stringify(inhoud, null, 2) + '\n');
  console.error(`Geschreven: ${doel} (${Object.keys(codes).length} installatie(s))`);
}

function cmdLees(opt) {
  const code = String(opt._[1] || '').trim();
  const delen = code.split('.');
  if (delen.length !== 3 || delen[0] !== PREFIX) stop('dit is geen MTK1-code');
  const payload = JSON.parse(unb64url(delen[1]).toString('utf8'));
  console.log(JSON.stringify(payload, null, 2));
  let pubB64 = opt.openbaar;
  if (!pubB64) {
    const p = path.join(STANDAARD_MAP, 'openbaar.txt');
    if (fs.existsSync(p)) pubB64 = fs.readFileSync(p, 'utf8').trim();
  }
  if (!pubB64) { console.error('(handtekening niet gecontroleerd: geen openbare sleutel)'); return; }
  const pub = crypto.createPublicKey({ key: Buffer.from(pubB64, 'base64'), format: 'der', type: 'spki' });
  const ok = crypto.verify(null, Buffer.from(`${delen[0]}.${delen[1]}`), pub, unb64url(delen[2]));
  console.error(ok ? 'Handtekening: geldig' : 'Handtekening: ONGELDIG');
}

const opt = args(process.argv.slice(2));
const opdrachten = { sleutel: cmdSleutel, code: cmdCode, intrekken: cmdIntrekken, bestand: cmdBestand, lees: cmdLees };
const fn = opdrachten[opt._[0]];
if (!fn) {
  console.error('Gebruik: node mtk-licentie.js <sleutel|code|intrekken|bestand|lees> [opties] — zie de kop van dit bestand.');
  process.exit(opt._[0] ? 1 : 0);
}
fn(opt);

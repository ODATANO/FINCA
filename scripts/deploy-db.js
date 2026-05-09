/**
 * Database deployment script — deploys both FINCA and ODATANO plugin tables,
 * then seeds CSVs from db/data/.
 *
 * Workaround for CAP BUG 5: `cds deploy` only generates DDL for consumer entities,
 * not for plugin entities from node_modules.
 *
 * CSV naming convention: `<namespace>-<EntityName>.csv` with `;` as separator.
 *
 * Usage: npm run deploy
 */
const cds = require('@sap/cds');
const path = require('path');
const fs = require('fs');

async function deploy() {
  const dbFile = path.join(__dirname, '..', 'db.sqlite');

  // Remove existing database (and SQLite WAL/SHM siblings) for clean deploy
  for (const ext of ['', '-wal', '-shm']) {
    const f = dbFile + ext;
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log('Removed', path.basename(f));
    }
  }

  // 1. Compile FINCA models
  console.log('Compiling FINCA models...');
  const fincaModel = await cds.load([
    path.join(__dirname, '..', 'db', 'schema.cds'),
    path.join(__dirname, '..', 'srv', 'finance-service.cds')
  ]);

  // 2. Compile ODATANO plugin models (if installed)
  let odatanoModel;
  try {
    const odatanoPath = path.dirname(require.resolve('@odatano/core/package.json'));
    console.log('Compiling ODATANO plugin models from:', odatanoPath);
    odatanoModel = await cds.load([
      path.join(odatanoPath, 'db', '*.cds'),
      path.join(odatanoPath, 'srv', '*.cds')
    ]);
  } catch (e) {
    console.warn('ODATANO plugin not installed, skipping plugin tables:', e.message);
  }

  // 3. Generate DDL and deploy
  const db = await cds.connect.to('db', {
    kind: 'sqlite',
    credentials: { url: dbFile }
  });

  console.log('Deploying FINCA schema...');
  await runDdl(db, cds.compile(fincaModel).to.sql());

  if (odatanoModel) {
    console.log('Deploying ODATANO schema...');
    await runDdl(db, cds.compile(odatanoModel).to.sql());
  }

  // 4. Seed data from CSV files
  const dataDir = path.join(__dirname, '..', 'db', 'data');
  if (fs.existsSync(dataDir)) {
    const csvFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv')).sort();
    console.log(`Seeding ${csvFiles.length} CSV file(s)...`);
    for (const file of csvFiles) {
      await seedCsv(db, path.join(dataDir, file));
    }
  }

  console.log('Database deployment complete:', dbFile);
  process.exit(0);
}

async function runDdl(db, statements) {
  for (const stmt of statements) {
    try {
      await db.run(stmt);
    } catch (e) {
      if (!/already exists/i.test(e.message)) {
        console.warn('DDL warning:', e.message);
      }
    }
  }
}

/**
 * Seed a single CSV file. Filename `<namespace>-<EntityName>.csv` →
 * table `<namespace>_<EntityName>` (CAP convention). Separator: `;`.
 */
async function seedCsv(db, filePath) {
  const fileName = path.basename(filePath, '.csv');
  const table = fileName.replace(/-/g, '_');

  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) {
    console.log(`  ${fileName}: empty, skipped`);
    return;
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine).map(values => {
    const row = {};
    headers.forEach((h, i) => {
      const v = values[i];
      row[h] = v === undefined || v === '' ? null : v;
    });
    return row;
  });

  try {
    await db.run(`DELETE FROM ${table}`);
    const placeholders = headers.map(() => '?').join(',');
    const cols = headers.join(',');
    for (const row of rows) {
      await db.run(
        `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`,
        headers.map(h => row[h])
      );
    }
    console.log(`  ${fileName}: ${rows.length} row(s)`);
  } catch (e) {
    console.warn(`  ${fileName} seeding failed:`, e.message);
  }
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ';') { out.push(cur); cur = ''; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

deploy().catch(err => {
  console.error('Deployment failed:', err);
  process.exit(1);
});

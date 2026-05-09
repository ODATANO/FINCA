/**
 * Custom CAP bootstrap — adds CORS middleware so browser-based clients
 * (SAPUI5 served from a different origin, embedded dashboards, Power BI Web,
 * Excel for the Web) can call the OData feeds.
 *
 * Note: Desktop Excel + Power Query do NOT enforce CORS — they go through
 * .NET HTTP. CORS only matters for browser-side callers. Enabled here for
 * dev convenience and embedded/web scenarios.
 */
const cds = require('@sap/cds');

// Whitelist for production — replace/extend as needed.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /\.sharepoint\.com$/,           // Excel Online / SharePoint
  /\.office\.com$/,                // Office 365
  /\.officeapps\.live\.com$/,      // Office Online
];

function isAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin));
}

cds.on('bootstrap', (app) => {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (isAllowed(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers',
        'Content-Type, Authorization, Accept, ' +
        'OData-Version, OData-MaxVersion, MaxDataServiceVersion, DataServiceVersion, ' +
        'X-Requested-With, X-CSRF-Token');
      res.header('Access-Control-Expose-Headers', 'OData-Version, X-CSRF-Token');
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
});

module.exports = cds.server;

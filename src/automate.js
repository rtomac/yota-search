const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const log4js = require('log4js');
const puppeteer = require('puppeteer');
const uuid = require('uuid');
const { stringify } = require('csv-stringify');

const BASE_URL = `https://www.toyota.com/search-inventory/model`;
const GRAPHQL_URI = 'https://api.search-inventory.toyota.com/graphql';
const GRAPHQL_QUERY = 'locateVehiclesByZip';
const GRAPHQL_QUERY_PATH = path.join(__dirname, 'query.graphql');
const NAVIGATE_TIMEOUT_S = 120;

const argv = yargs.argv;
const params = {
    model: param(argv.model, process.env.MODEL, 'corolla'),
    zipcode: param(argv.zipcode, process.env.ZIPCODE, '97204'),
    distance: param(argv.distance, process.env.DISTANCE, '20'),
    salePending: param(argv.salepending, process.env.SALEPENDING, 'true'),
    inTransit: param(argv.intransit, process.env.INTRANSIT, 'true'),
};
const jsonPathArg = param(argv.json, process.env.JSON);
const jsonPath = jsonPathArg ? path.resolve(jsonPathArg) : null;
const csvPathArg = param(argv.csv, process.env.CSV);
const csvPath = csvPathArg ? path.resolve(csvPathArg) : null;
const logLevel = param(argv.loglevel, process.env.LOGLEVEL, 'info');

log4js.configure({
    appenders: { console: { type: 'console' } },
    categories: { default: { appenders: ['console'], level: logLevel.toLowerCase() } },
});
const logger = log4js.getLogger();


async function main() {
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || null;
    const args = [ '--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--disable-dev-shm-usage' ];
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath,
        args: args,
    });
    logger.info('Launched Chrome browser with args:', args);

    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });
    logger.info('Created new tab in browser');

    // We can run in one of two modes:
    // 1. Load the initial page with query parameters and intercept the GraphQL responses
    // 2. Load the page with default query parameters and execute a custom GraphQL query
    let inventory;
    inventory = await runWithListenerOnPageQueries(page);
    //inventory = await runWithCustomQuery(page);

    logger.info(`Found a total of ${inventory.length} inventory entr(ies) to write`);

    if (jsonPath) {
        fs.writeFileSync(jsonPath, JSON.stringify(inventory, null, 2));
        logger.info(`Inventory JSON written to ${jsonPath}`);
    }

    if (csvPath) {
        writeInventoryToCsv(inventory, csvPath);
        logger.info(`Inventory CSV written to ${csvPath}`);
    }

    await browser.close();
}

function param(arg, env, def) {
    if (arg != null && String(arg).length) return arg;
    if (env != null && String(env).length) return env;
    return def;
}

async function runWithListenerOnPageQueries(page) {
    logger.info('Running with listener on page queries');

    const pageUrl = `${BASE_URL}/${params.model}/?zipcode=${params.zipcode}&distance=${params.distance}&salePending=${params.salePending}&inTransit=${params.inTransit}`;
    const inventory = [];

    page.on('response', (response) => onResponse(response, inventory));
    logger.debug('Attached response listener');

    await goto(page, pageUrl);
    logger.debug('Page content:', await page.content());
    // await page.screenshot({ path: 'screenshot.png' });

    return inventory;
}

async function runWithCustomQuery(page) {
    logger.info('Running with custom query');

    const pageUrl = `${BASE_URL}/${params.model}/?zipcode=${params.zipcode}`;
    const inventory = [];

    await goto(page, pageUrl);

    let query = fs.readFileSync(GRAPHQL_QUERY_PATH, 'utf8');
    for (const key in params) {
        query = query.replace(`{${key}}`, params[key]);
    }
    query = query.replace('{leadid}', uuid.v4());
    logger.debug('Executing GraphQL query:', query);

    await executeGraphQLQueryWithPaging(page, query, inventory);

    return inventory;
}

async function goto(page, url) {
    logger.info(`Navigating to URL ${url}`);
    await page.goto(url, { waitUntil: ['load', 'networkidle0'], timeout: NAVIGATE_TIMEOUT_S * 1000 });
}

async function onResponse(response, inventory) {
    const url = response.url().toLowerCase().trim();
    const status = response.status();
    logger.debug(`Handled response for URL ${url} with status ${status}`);

    if (url === GRAPHQL_URI) {
        if (!response.ok()) {
            throw new Error(`GraphQL request failed with ${status} status`);
        }

        const request = response.request();
        if (request.method().toUpperCase() === 'POST') {
            const postData = request.postData();
            logger.debug('Post data:', postData);

            if (postData.includes(GRAPHQL_QUERY)) {
                logger.info(`Captured response for GraphQL query from ${url}`);
                
                const json = await response.json();
                logger.debug('Response body', JSON.stringify(json, null, 2));
                processGraphQLResponse(json, inventory);
            }
        }
    }
}

function processGraphQLResponse(json, inventory) {
    const vehicles = json.data[GRAPHQL_QUERY]['vehicleSummary'];
    logger.info(`Found ${vehicles.length} vehicle(s)`);
    inventory.push(...vehicles)
}

async function executeGraphQLQueryWithPaging(page, query, inventory) {
    let pageNo = 1, totalPages = 1;
    while (pageNo <= totalPages) {
        const json = await executeGraphQLQuery(page, query.replace('{pageNo}', pageNo));
        logger.debug(`GraphQL query for page ${pageNo} returned:`, JSON.stringify(json, null, 2));

        totalPages = json.data[GRAPHQL_QUERY].pagination.totalPages;
        logger.debug(`GraphQL query indicated total pages:`, totalPages);
        processGraphQLResponse(json, inventory);
        pageNo++;
    }
}

async function executeGraphQLQuery(page, query) {
    logger.debug('Executing graphql query:', query);

    let fetchSuccess, fetchError;
    const fetchComplete = new Promise((resolve, reject) => {
        fetchSuccess = resolve;
        fetchError = reject;
    });
    await page.exposeFunction('fetchSuccess', fetchSuccess);
    await page.exposeFunction('fetchError', (error) => {
        fetchError(new Error(`GraphQL request failed with error: ${error}`));
    });

    try {
        await page.addScriptTag({
            content: `
                fetch(
                    '${GRAPHQL_URI}',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: \`${query}\` }),
                    })
                    .then(response => {
                        if (!response.ok) throw new Error('HTTP Error: ' + response.status);
                        return response.json();
                    })
                    .then(data => { window.fetchSuccess(data); })
                    .catch(error => { window.fetchError(error.message); });
            `.trim(),
          });
          logger.info('Added script to execute graphql query');
    
          return await fetchComplete;
    }
    finally {
        await page.removeExposedFunction('fetchSuccess');
        await page.removeExposedFunction('fetchError');
    }
}

function writeInventoryToCsv(inventory, inventoryCsvPath) {
    const map = {
        'VIN': v => v.vin,
        'Name': v => v.model.marketingName,
        'Model': v => v.model.marketingTitle,
        'Year': v => v.year,
        'Status': v => v.inventoryStatus,
        'Base MSRP': v => v.price.baseMsrp,
        'Total MSRP': v => v.price.totalMsrp,
        'Advertised Price': v => v.price.advertisedPrice,
        'Selling Price': v => v.price.sellingPrice,
        'Exterior Color': v => v.extColor.marketingName,
        'Interior Color': v => v.intColor.marketingName,
        'Engine': v => v.engine.name,
        'Drivetrain': v => v.drivetrain.title,
        'Transmission': v => v.transmission.transmissionType,
        'MPG City': v => v.mpg.city,
        'MPG Highway': v => v.mpg.highway,
        'MPG Combined': v => v.mpg.combined,
        'Dealer': v => v.dealerMarketingName,
        'Dealer Website': v => v.dealerWebsite,
        'Distance': v => v.distance,
        'Option Codes': v => v.options.map(o => o.optionCd).join(','),
        'Option Names': v => v.options.map(o => o.marketingName).join(','),

    };

    const headers = Object.keys(map);
    const rows = inventory.map(v => {
        return Object.values(map).map(fn => fn(v));
    });
    const data = [headers, ...rows];

    const stringifier = stringify();
    data.forEach(row => stringifier.write(row));
    const stream = fs.createWriteStream(inventoryCsvPath);
    try {
        stringifier.pipe(stream);
    }
    finally {
        stringifier.end();
    }
}


(async () => {
    await main();
})();

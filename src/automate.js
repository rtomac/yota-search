const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const uuid = require('uuid');
const { stringify } = require('csv-stringify');

const BASE_URL = `https://www.toyota.com/search-inventory/model`;
const GRAPHQL_URI = 'https://api.search-inventory.toyota.com/graphql';
const GRAPHQL_QUERY = 'locateVehiclesByZip';
const GRAPHQL_QUERY_PATH = path.join(__dirname, 'query.graphql');

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


async function main() {
    let executablePath = process.env.CHROME_EXECUTABLE_PATH || null;
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath,
        args: [ '--no-sandbox', '--disable-setuid-sandbox', '--start-maximized', '--disable-dev-shm-usage' ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });

    // We can run in one of two modes:
    // 1. Load the initial page with query parameters and intercept the GraphQL responses
    // 2. Load the page with default query parameters and execute a custom GraphQL query
    let inventory;
    inventory = await runWithListenerOnPageQueries(page);
    //inventory = await runWithCustomQuery(page);

    if (jsonPath) {
        fs.writeFileSync(jsonPath, JSON.stringify(inventory, null, 2));
        console.log(`Inventory JSON written to ${jsonPath}`);
    }

    if (csvPath) {
        writeInventoryToCsv(inventory, csvPath);
        console.log(`Inventory CSV written to ${csvPath}`);
    }

    await browser.close();
}

function param(arg, env, def) {
    if (arg != null && String(arg).length) return arg;
    if (env != null && String(env).length) return env;
    return def;
}

async function runWithListenerOnPageQueries(page) {
    const pageUrl = `${BASE_URL}/${params.model}/?zipcode=${params.zipcode}&distance=${params.distance}&salePending=${params.salePending}&inTransit=${params.inTransit}`;
    const inventory = [];

    console.log(`Navigating to page ${pageUrl}`);
    page.on('response', (response) => onResponse(response, inventory));
    await page.goto(pageUrl, { waitUntil: ['load', 'networkidle0'] });
    // const pageContent = await page.content();
    // console.log(pageContent);
    // await page.screenshot({ path: 'screenshot.png' });

    return inventory;
}

async function runWithCustomQuery(page) {
    const pageUrl = `${BASE_URL}/${params.model}/?zipcode=${params.zipcode}`;
    const inventory = [];

    console.log(`Navigating to page ${pageUrl}`);
    await page.goto(pageUrl, { waitUntil: ['load', 'networkidle0'] });

    let query = fs.readFileSync(GRAPHQL_QUERY_PATH, 'utf8');
    for (const key in params) {
        query = query.replace(`{${key}}`, params[key]);
    }
    query = query.replace('{leadid}', uuid.v4());
    //console.log(`Executing GraphQL query: ${query}`);

    await executeGraphQLQueryWithPaging(page, query, inventory);

    return inventory;
}

async function onResponse(response, inventory) {
    const url = response.url().toLowerCase().trim();
    if (url === GRAPHQL_URI) {
        const request = response.request();
        if (request.method().toUpperCase() === 'POST') {
            const postData = request.postData();
            //console.log(postData);
            if (postData.includes(GRAPHQL_QUERY)) {
                console.log(`Captured response for GraphQL query from ${url}`);
                if (response.ok) {
                    const json = await response.json();
                    //console.log(JSON.stringify(json, null, 2));
                    processGraphQLResponse(json, inventory);
                }
                else {
                    throw new Error(`GraphQL request failed with ${response.status} status`);
                }
            }
        }
    }
}

function processGraphQLResponse(json, inventory) {
    const vehicles = json.data[GRAPHQL_QUERY]['vehicleSummary'];
    console.log(`Found ${vehicles.length} vehicle(s)`);
    inventory.push(...vehicles)
}

async function executeGraphQLQueryWithPaging(page, query, inventory) {
    let pageNo = 1, totalPages = 1;
    while (pageNo <= totalPages) {
        const json = await executeGraphQLQuery(page, query.replace('{pageNo}', pageNo));
        //console.log(JSON.stringify(json, null, 2));
        totalPages = json.data[GRAPHQL_QUERY].pagination.totalPages;
        processGraphQLResponse(json, inventory);
        pageNo++;
    }
}

async function executeGraphQLQuery(page, query) {    
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
        console.log('Adding script to execute graphql query');
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

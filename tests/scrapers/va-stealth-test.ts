import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function testVAStealth() {
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-http2'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  const graphqlResponses: any[] = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('graphql')) {
      try {
        const json = await resp.json();
        graphqlResponses.push({ url, data: json });
        console.log(`GraphQL response: ${JSON.stringify(json).substring(0, 500)}`);
      } catch {}
    }
  });

  const url = 'https://www.virginatlantic.com/flights/search/results?origin=JFK&destination=NRT&departure=2026-03-15&ADT=1&cabin=upper&tripType=ONE_WAY&awardSearch=true';
  console.log('Loading VA search with stealth...', url);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e: any) {
    console.log('Nav:', e.message);
  }

  // Wait for potential API calls
  console.log('Waiting for API responses...');
  await page.waitForTimeout(20000);

  console.log(`GraphQL responses: ${graphqlResponses.length}`);
  console.log(`Page title: ${await page.title()}`);
  console.log(`URL: ${page.url()}`);

  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 800) || '');
  console.log(`\nPage text:\n${bodyText}`);

  // Try direct GraphQL call from the page context
  if (graphqlResponses.length === 0) {
    console.log('\nTrying direct GraphQL from page context...');
    try {
      const result = await page.evaluate(async () => {
        const resp = await fetch('/flights/search/api/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationName: 'SearchOffers',
            variables: {
              request: {
                pos: null, parties: null,
                flightSearchRequest: {
                  searchOriginDestinations: [{ origin: 'JFK', destination: 'NRT', departureDate: '2026-03-15' }],
                  bundleOffer: false, awardSearch: true, calendarSearch: false,
                  flexiDateSearch: false, nonStopOnly: false, currentTripIndexId: '0',
                  checkInBaggageAllowance: false, carryOnBaggageAllowance: false, refundableOnly: false,
                },
                customerDetails: [{ custId: 'ADT_0', ptc: 'ADT' }],
              },
            },
            query: `query SearchOffers($request: FlightOfferRequestInput!) {
              searchOffers(request: $request) {
                result { slice { flightsAndFares {
                  flight { segments { airline { code name } flightNumber operatingAirline { code name }
                    origin { code } destination { code } duration departure arrival }
                    duration origin { code } destination { code } departure arrival }
                  fares { availability price { awardPoints tax currency } fareSegments { cabinName bookingClass isSaverFare }
                    available fareFamilyType availableSeatCount isSaverFare } } } } } }`,
          }),
        });
        return { status: resp.status, body: (await resp.text()).substring(0, 3000) };
      });
      console.log(`GraphQL direct: ${result.status}`);
      console.log(result.body.substring(0, 1500));
    } catch (e: any) {
      console.log('GraphQL error:', e.message);
    }
  }

  await browser.close();
}

testVAStealth().catch(e => console.error(e));

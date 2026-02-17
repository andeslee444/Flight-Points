import { chromium } from 'playwright';

async function testGraphQL() {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Intercept API calls on the search results page
  const apiResponses: any[] = [];
  
  page.on('request', (req) => {
    if (req.url().includes('graphql') || req.url().includes('/api/') || req.url().includes('search')) {
      const ct = req.headers()['content-type'] || '';
      if (ct.includes('json') || req.method() === 'POST') {
        console.log(`>> ${req.method()} ${req.url().substring(0, 150)}`);
        if (req.postData()) console.log(`   Body: ${req.postData()?.substring(0, 300)}`);
      }
    }
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('graphql') || (url.includes('search') && url.includes('api'))) {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('json')) {
        try {
          const json = await resp.json();
          console.log(`<< ${resp.status()} ${url.substring(0, 150)}`);
          console.log(`   Response: ${JSON.stringify(json).substring(0, 1000)}`);
          apiResponses.push(json);
        } catch {}
      }
    }
  });

  // Go directly to search results for JFK-NRT
  const url = 'https://www.virginatlantic.com/flights/search/results?origin=JFK&destination=NRT&departure=2026-03-15&ADT=1&cabin=upper&tripType=ONE_WAY&awardSearch=true';
  console.log('Loading:', url);
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e: any) {
    console.log('Nav:', e.message);
  }
  
  await page.waitForTimeout(20000);

  console.log(`\nTotal API responses captured: ${apiResponses.length}`);
  console.log('Page title:', await page.title());
  
  // Try calling the GraphQL API directly from page context
  console.log('\n=== Trying direct GraphQL call ===');
  try {
    const result = await page.evaluate(async () => {
      const payload = {
        operationName: 'SearchOffers',
        variables: {
          request: {
            pos: null,
            parties: null,
            flightSearchRequest: {
              searchOriginDestinations: [{
                origin: 'JFK',
                destination: 'NRT',
                departureDate: '2026-03-15',
              }],
              bundleOffer: false,
              awardSearch: true,
              calendarSearch: false,
              flexiDateSearch: false,
              nonStopOnly: false,
              currentTripIndexId: '0',
              checkInBaggageAllowance: false,
              carryOnBaggageAllowance: false,
              refundableOnly: false,
            },
            customerDetails: [{ custId: 'ADT_0', ptc: 'ADT' }],
          },
        },
        query: `query SearchOffers($request: FlightOfferRequestInput!) {
          searchOffers(request: $request) {
            result {
              slice {
                flightsAndFares {
                  flight {
                    segments {
                      airline { code name }
                      flightNumber
                      operatingAirline { code name }
                      origin { code }
                      destination { code }
                      duration
                      departure
                      arrival
                    }
                    duration origin { code } destination { code } departure arrival
                  }
                  fares {
                    availability id
                    price { awardPoints tax amountIncludingTax currency }
                    fareSegments { cabinName bookingClass isSaverFare }
                    available fareFamilyType availableSeatCount isSaverFare
                  }
                }
              }
            }
          }
        }`,
      };
      const resp = await fetch('/flights/search/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: resp.status, body: (await resp.text()).substring(0, 3000) };
    });
    console.log(`Status: ${result.status}`);
    console.log(`Body: ${result.body}`);
  } catch (e: any) {
    console.log('Error:', e.message);
  }

  await browser.close();
}

testGraphQL().catch(e => console.error(e));

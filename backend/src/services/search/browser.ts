import vanillaPuppeteer, { type Browser } from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// A separate puppeteer-extra instance so the stealth plugin isn't registered twice
// on the singleton that scraper.ts configures.
const puppeteer = addExtra(vanillaPuppeteer);
puppeteer.use(StealthPlugin());

// Store searches fan out to several stores at once, so instead of launching a browser
// per request (as scraper.ts does) we share one and cap the number of open pages.
const MAX_CONCURRENT_PAGES = 3;
const IDLE_CLOSE_MS = 60_000;

let browserPromise: Promise<Browser> | null = null;
let activePages = 0;
let idleTimer: NodeJS.Timeout | null = null;
const waiters: (() => void)[] = [];

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--disable-crash-reporter',
          '--window-size=1920,1080',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        ignoreDefaultArgs: ['--enable-automation'],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

async function acquireSlot(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  // The slot is handed over by releaseSlot without decrementing
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  activePages--;
  if (activePages === 0) {
    idleTimer = setTimeout(async () => {
      const current = browserPromise;
      browserPromise = null;
      if (current) {
        try {
          await (await current).close();
        } catch {
          // Already closed
        }
      }
    }, IDLE_CLOSE_MS);
  }
}

/**
 * Render a page in headless Chrome and return its HTML.
 * Waits for `waitFor` when given, otherwise for the network to settle.
 */
export async function renderPage(url: string, waitFor?: string, timeoutMs = 45_000): Promise<string> {
  await acquireSlot();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1920, height: 1080 });

      // Images, fonts and media are irrelevant for reading search results
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (['image', 'font', 'media'].includes(request.resourceType())) {
          request.abort().catch(() => undefined);
        } else {
          request.continue().catch(() => undefined);
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

      // Give Cloudflare-style interstitials a chance to resolve
      const challengeDeadline = Date.now() + 20_000;
      while (Date.now() < challengeDeadline) {
        const title = (await page.title()).toLowerCase();
        if (!title.includes('just a moment') && !title.includes('checking your browser')) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout: 20_000 }).catch(() => undefined);
      } else {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15_000 }).catch(() => undefined);
      }

      return await page.content();
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    releaseSlot();
  }
}

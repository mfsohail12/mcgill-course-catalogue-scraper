const puppeteer = require("puppeteer");
const axios = require("axios");
const xml2js = require("xml2js");
const fs = require("fs");

const CONCURRENCY = 10; // number of parallel browser pages

async function extractSitemapLinks() {
  const { data } = await axios.get(
    "https://coursecatalogue.mcgill.ca/sitemap.xml",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      maxRedirects: 5,
    },
  );

  if (!data || String(data).trim().length === 0) {
    throw new Error("Empty response from server");
  }

  const parsed = await xml2js.parseStringPromise(String(data), {
    explicitArray: true,
  });

  if (parsed.urlset) {
    return parsed.urlset.url.map((entry) => entry.loc[0]);
  } else if (parsed.sitemapindex) {
    return parsed.sitemapindex.sitemap.map((entry) => entry.loc[0]);
  } else {
    throw new Error(
      "Unrecognized sitemap format: " + JSON.stringify(parsed).slice(0, 500),
    );
  }
}

async function isPageAProgram(page, link) {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
  return page.evaluate(
    () => document.getElementById("programoverviewtexttab") !== null,
  );
}

async function runPool(links, browser) {
  const programLinks = [];
  const queue = [...links];

  async function worker() {
    const page = await browser.newPage();

    // Block images, fonts, stylesheets — we only need the DOM
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (
        ["image", "stylesheet", "font", "media"].includes(req.resourceType())
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    while (queue.length > 0) {
      const link = queue.shift();
      try {
        const isProgram = await isPageAProgram(page, link);
        if (isProgram) {
          console.log("Program:", link);
          programLinks.push(link);
        }
      } catch (err) {
        console.warn(`Failed: ${link} — ${err.message}`);
      }
    }

    await page.close();
  }

  // Spin up CONCURRENCY workers, all draining the same queue
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return programLinks;
}

const collectPrograms = async () => {
  const links = (await extractSitemapLinks()).filter((link) =>
    link.includes("undergraduate"),
  );
  console.log(`Extracted ${links.length} links from sitemap`);

  const browser = await puppeteer.launch({ headless: true });

  try {
    const programLinks = await runPool(links, browser);

    // Load existing, merge, dedupe, save
    const existing = JSON.parse(fs.readFileSync("program-links.json", "utf8"));
    const newLinks = programLinks.filter((l) => !existing.includes(l));

    if (newLinks.length > 0) {
      const merged = [...existing, ...newLinks];
      fs.writeFileSync("program-links.json", JSON.stringify(merged, null, 2));
      console.log(
        `Added ${newLinks.length} new program links (${merged.length} total)`,
      );
    } else {
      console.log("No new program links found");
    }
  } finally {
    await browser.close();
  }
};

collectPrograms();

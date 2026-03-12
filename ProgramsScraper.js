const puppeteer = require("puppeteer");
const fs = require("fs");

const scrapeProgramListingPages = async (startingURL) => {
  if (!startingURL) throw new Error("No starting URL provided");

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(startingURL, {
    waitUntil: "networkidle0",
  });

  // Collect anchor links
  const anchorLinks = await page.evaluate(() => {
    const parent =
      document.getElementById("departmentstextcontainer") ||
      document.getElementById("academicunitstextcontainer");
    const links = [];

    if (parent) {
      const anchors = parent.querySelectorAll("li a");

      for (const anchor of anchors) {
        if (anchor.href) {
          links.push(anchor.href);
        }
      }
    }

    return links;
  });

  const validLinks = [];
  const invalidLinks = [];

  // Visit each link and check for programs page
  for (const link of anchorLinks) {
    try {
      await page.goto(link, { waitUntil: "networkidle0" });

      const hasProgramsSection = await page.evaluate(() => {
        return (
          document.querySelector("a[href='#programstextcontainer']") !== null
        );
      });

      if (hasProgramsSection) {
        const finalLink = link + "#programstext";

        validLinks.push(finalLink);
        console.log("Found a page with program links", finalLink);
      } else {
        invalidLinks.push(link);
        console.log("Unable to find a page with program links for", link);
      }
    } catch (err) {
      throw err;
    }
  }

  await browser.close();

  // Populating program listing page links into JSON file
  const existingData = JSON.parse(
    fs.readFileSync("program-listing-pages.JSON", "utf8"),
  );

  // Populating valid links making sure to avoid duplicates
  const uniqueValidLinks = validLinks.filter(
    (item) => !existingData.valid.includes(item),
  );
  existingData.valid.push(...uniqueValidLinks);

  // Populating invalid links making sure to avoid duplicates
  const uniqueInvalidLinks = invalidLinks.filter(
    (item) => !existingData.invalid.includes(item),
  );
  existingData.invalid.push(...uniqueInvalidLinks);

  if (uniqueValidLinks.length == 0 && uniqueInvalidLinks.length == 0) {
    console.log("No new valid or invalid links were found for ", startingURL);
    return;
  }
  // Writing changes to JSON file
  fs.writeFileSync(
    "program-listing-pages.JSON",
    JSON.stringify(existingData, null, 2),
  );
};

const checkValidProgramLink = async (page, link) => {
  await page.goto(link, {
    waitUntil: "networkidle0",
  });

  return await page.evaluate(() => {
    return document.getElementById("programoverviewtexttab") !== null;
  });
};

const scrapeProgramLinks = async () => {
  const programListingPages = JSON.parse(
    fs.readFileSync("program-listing-pages.JSON", "utf8"),
  );

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  const programLinks = []; // holds all program links collected

  // Collecting program links from valid program listing pages
  for (const link of programListingPages.valid) {
    // Navigate to link
    await page.goto(link, {
      waitUntil: "networkidle0",
    });

    // Gathering all links on the page that may or may not link to a program page
    const candidateLinks = await page.evaluate(() => {
      const anchors = document.querySelectorAll("a[href*='/undergraduate/']");
      const links = [];

      for (const anchor of anchors) {
        if (anchor.href) {
          links.push(anchor.href);
        }
      }

      return links;
    });

    // Filtering candidate links to only links that go to a program
    for (const candidateLink of candidateLinks) {
      if (await checkValidProgramLink(page, candidateLink)) {
        console.log("Found a valid program link", candidateLink);
        programLinks.push(candidateLink);
      }
    }
  }

  await browser.close();

  // Writing program links to JSON file
  const programs = JSON.parse(fs.readFileSync("program-links.JSON", "utf8"));

  // filtering to program links not already collected in JSON file
  const uniqueProgramLinks = [...new Set(programLinks)].filter(
    (programLink) => !programs.includes(programLink),
  );

  programs.push(...uniqueProgramLinks);

  fs.writeFileSync("program-links.JSON", JSON.stringify(programs, null, 2));
};

const main = async () => {
  const startingURL = "https://coursecatalogue.mcgill.ca/en/undergraduate/";

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(startingURL, {
    waitUntil: "networkidle0",
  });

  // Collecting links for each undergrad studies section available at McGill
  const undergraduatePages = await page.evaluate(() => {
    const anchors = document.querySelectorAll(
      "div.sitemap a[href*='/undergraduate/']",
    );
    const links = [];

    for (const anchor of anchors) {
      if (anchor.href) {
        links.push(anchor.href);
      }
    }

    return links;
  });

  const filteredPages = [];

  for (const undergraduatePage of undergraduatePages) {
    await page.goto(undergraduatePage, {
      waitUntil: "networkidle0",
    });

    const hasAcademicUnits = await page.evaluate(() => {
      var xpath = "//a[text()='Academic Units']";
      var matchingElement = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue;
      return matchingElement !== null;
    });

    if (hasAcademicUnits) {
      console.log("adding " + undergraduatePage + " to filtered");
      filteredPages.push(undergraduatePage);
    }
  }

  await browser.close();

  for (const undergraduatePage of filteredPages) {
    await scrapeProgramListingPages(undergraduatePage);
  }

  // Collecting program links
  await scrapeProgramLinks();
};

//main();
scrapeProgramLinks();

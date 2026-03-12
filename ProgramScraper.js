const puppeteer = require("puppeteer");

const scrapeGroupCourses = async (url) => {
  if (!url) throw new Error("No URL provided");

  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);

    const courseGroups = await page.evaluate(() => {
      // Select all tables with class "sc_courselist"
      const tables = document.querySelectorAll("table.sc_courselist");
      const result = [];

      tables.forEach((table) => {
        // For each table, collect course codes from <td class="codecol">
        const codes = Array.from(table.querySelectorAll("td.codecol")).map(
          (td) => td.innerText.trim()
        );
        // Join course codes into a comma-separated string
        if (codes.length > 0) {
          result.push(codes.join(", "));
        }
      });

      return result;
    });

    for (let i = 0; i < courseGroups.length; i++) {
      console.log("Group ", i + 1, ":");
      console.log(courseGroups[i] + "\n");
    }

    await browser.close();
  } catch (error) {
    throw error;
  }
};

const url =
  "https://coursecatalogue.mcgill.ca/en/undergraduate/science/programs/mathematics-statistics/mathematics-honours-bsc/#coursestext";

scrapeGroupCourses(url);

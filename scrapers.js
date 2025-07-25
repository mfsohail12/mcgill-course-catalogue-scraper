const puppeteer = require("puppeteer");

const scrapeCourse = async (course) => {
  const url = `https://coursecatalogue.mcgill.ca/courses/${course}/`;

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);

  const [el] = await page.$$('xpath/.//*[@id="contentarea"]/h1');
  const titleText = await el.getProperty("textContent");
  const title = await titleText.jsonValue();
  const courseCodeRegex = /\b[A-Z]{4} \d{3}[A-Z0-9]*\b/;
  const [courseCode] = title.match(courseCodeRegex);
  const courseName = title
    .replace(courseCodeRegex, "")
    .replace(/\./g, "")
    .trim();

  const [el2] = await page.$$(
    'xpath/.//*[@id="textcontainer"]/div/div[1]/div[1]/span[2]'
  );
  const creditsText = await el2.getProperty("textContent");
  const credits = parseInt(await creditsText.jsonValue());

  const [el3] = await page.$$(
    'xpath/.//*[@id="textcontainer"]/div/div[2]/div/div'
  );
  const descText = await el3.getProperty("textContent");
  const description = await descText.jsonValue();

  const [el4] = await page.$$(
    'xpath/.//*[@id="textcontainer"]/div/div[1]/div[2]/span[2]'
  );
  const facultyText = await el4.getProperty("textContent");
  const faculty = await facultyText.jsonValue();

  const bullets = await page.$eval(
    "#textcontainer > div > div:nth-child(3) > div > ul",
    (ul) => {
      const bulletsArr = [];

      for (let i = 0; i < ul.children.length; i++) {
        bulletsArr.push(ul.children[i].textContent);
      }

      return bulletsArr;
    }
  );

  let prereqs;
  let restrictions;

  for (let i = 0; i < bullets.length; i++) {
    const prereqRegex = /^Prerequisites?:/;
    const restrictionsRegex = /^Restrictions?:/;

    if (prereqRegex.test(bullets[i])) {
      prereqs = bullets[i].replace(prereqRegex, "").trim();
    } else if (restrictionsRegex.test(bullets[i])) {
      restrictions = bullets[i].replace(restrictionsRegex, "").trim();
    }
  }

  console.log({
    courseName,
    courseCode,
    credits,
    description,
    faculty,
    prereqs,
    restrictions,
  });

  browser.close();
};

scrapeCourse("comp-552");

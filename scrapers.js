require("dotenv").config();
const puppeteer = require("puppeteer");
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  const courseDescription = await descText.jsonValue();

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

  browser.close();

  let prereqs;
  let restrictions;

  for (let i = 0; i < bullets.length; i++) {
    const prereqRegex = /^Prerequisite(s|\(s\))?:/;
    const restrictionsRegex = /^Restriction(s|\(s\))?:/;

    if (prereqRegex.test(bullets[i])) {
      prereqs = bullets[i].replace(prereqRegex, "").trim();
    } else if (restrictionsRegex.test(bullets[i])) {
      restrictions = bullets[i].replace(restrictionsRegex, "").trim();
    }
  }

  if (!prereqs) {
    console.log({
      courseName,
      courseCode,
      credits,
      courseDescription,
      faculty,
      prerequisites: prereqs,
      prerequisitesBoolExp: null,
      restrictions,
    });

    return {
      courseName,
      courseCode,
      credits,
      courseDescription,
      faculty,
      prerequisites: prereqs,
      prerequisitesBoolExp: null,
      restrictions,
    };
  }

  console.log("parsing prereqs to bool exp ...");
  const chatResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Convert university course prerequisite strings to structured boolean expression strings using course codes and logic symbols (AND, OR, parentheses). Letters in course codes should be capitalized in the final output string. Ignore and remove phrases like "or equivalent", "permission of instructor", or anything else that does not relate to a specific course. If there are no course prerequisites, return an empty string.\n\nExamples:\nInput: "Math 350 or COMP 362 (or equivalent)."\nOutput: (MATH 350 OR COMP 362)\n\nInput: "COMP 251 and COMP 250 and (MATH 140 or MATH 240 or MATH 200)"\nOutput: COMP 251 AND COMP 250 AND (MATH 140 OR MATH 240 OR MATH 200)\n\nInput: "COMP 251 or equivalent, MATH 223"\nOutput: COMP 251 AND MATH 223`,
      },
      {
        role: "user",
        content: prereqs || "None",
      },
    ],
    temperature: 0,
  });

  const booleanPrereq = chatResponse.choices[0].message.content;

  console.log({
    courseName,
    courseCode,
    credits,
    courseDescription,
    faculty,
    prerequisites: prereqs,
    prerequisitesBoolExp: booleanPrereq,
    restrictions,
  });

  return {
    courseName,
    courseCode,
    credits,
    courseDescription,
    faculty,
    prerequisites: prereqs,
    prerequisitesBoolExp: booleanPrereq,
    restrictions,
  };
};

scrapeCourse("comp-360");

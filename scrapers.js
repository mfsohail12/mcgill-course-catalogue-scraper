require("dotenv").config();
const puppeteer = require("puppeteer");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { allCourses, filterCoursesByDept } = require("./courses");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL,
  process.env.SUPABASE_API_KEY
);

const scrapeCourse = async (course) => {
  try {
    const url = `https://coursecatalogue.mcgill.ca/courses/${course}/`;

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);

    const [el] = await page.$$('xpath/.//*[@id="contentarea"]/h1');
    let courseCode = "";
    let courseName = "";
    if (el) {
      const titleText = await el.getProperty("textContent");
      const title = await titleText.jsonValue();
      const courseCodeRegex = /\b[A-Z]{4} \d{3}[A-Z0-9]*\b/;
      if (courseCodeRegex.test(title)) {
        [courseCode] = title.match(courseCodeRegex);
        courseName = title
          .replace(courseCodeRegex, "")
          .replace(/\./g, "")
          .trim();
      }
    }
    if (!courseCode)
      throw new Error(
        "Missing essential course info after scraping: course code"
      );

    const [el2] = await page.$$(
      'xpath/.//*[@id="textcontainer"]/div/div[1]/div[1]/span[2]'
    );
    let credits = 0;
    if (el2) {
      const creditsText = await el2.getProperty("textContent");
      credits = parseInt(await creditsText.jsonValue());
    }

    const [el3] = await page.$$(
      'xpath/.//*[@id="textcontainer"]/div/div[2]/div/div'
    );
    let courseDescription = "";
    if (el3) {
      const descText = await el3.getProperty("textContent");
      courseDescription = await descText.jsonValue();
    }

    const [el4] = await page.$$(
      'xpath/.//*[@id="textcontainer"]/div/div[1]/div[2]/span[2]'
    );
    let faculty = "";
    if (el4) {
      const facultyText = await el4.getProperty("textContent");
      faculty = await facultyText.jsonValue();
    }

    const ulElement = await page.$(
      "#textcontainer > div > div:nth-child(3) > div > ul"
    );

    let bullets = [];

    if (ulElement) {
      bullets = await page.evaluate((ul) => {
        const bulletsArr = [];
        for (let i = 0; i < ul.children.length; i++) {
          bulletsArr.push(ul.children[i].textContent);
        }
        return bulletsArr;
      }, ulElement);
    }

    await browser.close();

    let prereqs = "";
    let restrictions = "";

    for (let i = 0; i < bullets.length; i++) {
      const prereqRegex = /^Prerequisite(s|\(s\))?:/;
      const restrictionsRegex = /^Restriction(s|\(s\))?:/;

      if (prereqRegex.test(bullets[i])) {
        prereqs = bullets[i].replace(prereqRegex, "").trim();
      } else if (restrictionsRegex.test(bullets[i])) {
        restrictions = bullets[i].replace(restrictionsRegex, "").trim();
      }
    }

    let booleanPrereq = "";

    if (prereqs) {
      console.log("parsing prereqs to bool exp ...");
      const chatResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Convert university course prerequisite strings to structured boolean expression strings using course codes and logic symbols (AND, OR, parentheses). Letters in course codes should be capitalized in the final output string. Ignore and remove phrases like "or equivalent", "permission of instructor", or anything else that does not relate to a specific course. If there are no course prerequisites, return an empty string.\n\nExamples:\nInput: "Math 350 or COMP 362 (or equivalent)."\nOutput: (MATH 350 OR COMP 362)\n\nInput: "COMP 251 and COMP 250 and (MATH 140 or MATH 240 or MATH 200)"\nOutput: COMP 251 AND COMP 250 AND (MATH 140 OR MATH 240 OR MATH 200)\n\nInput: "COMP 251 or equivalent, MATH 223"\nOutput: COMP 251 AND MATH 223\n\nInput: "MATH 140 or equivalent. COMP 202 or COMP 204 or COMP 208 (or equivalent)."\nOutput: "MATH 140 AND (COMP 202 OR COMP 204 OR COMP 208)"\n\nInput: "ATOC 752D1"\nOutput: "ATOC 752D1"`,
          },
          {
            role: "user",
            content: prereqs || "None",
          },
        ],
        temperature: 0,
      });

      booleanPrereq = chatResponse.choices[0].message.content;
    }

    console.log({
      course_name: courseName,
      course_code: courseCode,
      credits,
      course_description: courseDescription,
      faculty_name: faculty,
      prerequisites: prereqs,
      prerequisites_bool_exp: booleanPrereq,
      restrictions,
    });

    return {
      course_name: courseName,
      course_code: courseCode,
      credits,
      course_description: courseDescription,
      faculty_name: faculty,
      prerequisites: prereqs,
      prerequisites_bool_exp: booleanPrereq,
      restrictions,
    };
  } catch (error) {
    console.log(`there was an error scraping the course ${course}: ${error}`);
  } finally {
  }
};

// comp-202 --> COMP 202
const convertCourseCode = (code) => {
  return code.replace("-", " ").toUpperCase();
};

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// example usage: scrapeCourses("comp") // scrapes all comp courses at mcgill and populates into DB
const scrapeCoursesFromDept = async (dept) => {
  const failedCourses = [];

  try {
    const courses = filterCoursesByDept(dept);

    for (let i = 0; i < courses.length; i++) {
      console.log("----------------------------------------------");
      console.log("Scraping course ", i);
      // checking if the course already exists in the db
      const { data: fetchData, error: fetchError } = await supabase
        .from("course")
        .select()
        .eq("course_code", convertCourseCode(courses[i]));

      if (fetchError) {
        console.log(
          `Error checking if course ${courses[i]} is in the database`
        );
      }

      if (fetchData && fetchData.length > 0) {
        console.log(
          `Error: ${courses[i]} information is already in the database`
        );
        continue;
      }

      const courseData = await scrapeCourse(courses[i]);

      if (!courseData) {
        failedCourses.push(courses[i]);
        continue;
      }

      const { error: insertError } = await supabase
        .from("course")
        .insert(courseData);

      if (insertError) {
        console.log(
          `Error inserting course ${courses[i]} into the database: ${insertError}`
        );
        failedCourses.push(courses[i]);
      }

      await sleep(Math.round(1000 + Math.random() * 4000));
    }

    console.log({ failedCourses, length: failedCourses.length });
    console.log("Scraping finished!");
  } catch (error) {
    console.log("Error scraping courses: ", error);
  }
};

const scienceDepts = [
  "anat",
  "atoc",
  "bioc",
  "biol",
  "biot",
  "chem",
  "comp",
  "epsc",
  "esys",
  "exmd",
  "geog",
  "math",
  "mimm",
  "neur",
  "nutr",
  "path",
  "phar",
  "phys",
  "phgy",
  "psyt",
  "psyc",
  "redm",
];

const run = async () => {
  for (let i = 0; i < scienceDepts.length; i++) {
    await scrapeCoursesFromDept(scienceDepts[i]);
  }
};

run();

const fs = require("fs");
const path = require("path");

function renderEmailTemplate(fileName, variables = {}) {
  const templatePath = path.join(
    __dirname,
    "..",
    "..",
    "templates",
    "email",
    fileName
  );

  let content = fs.readFileSync(templatePath, "utf8");

  for (const key in variables) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    content = content.replace(regex, variables[key]);
  }

  return content;
}

module.exports = renderEmailTemplate;

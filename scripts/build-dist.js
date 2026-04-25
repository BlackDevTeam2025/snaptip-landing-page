const fs = require("fs/promises");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

const rootFiles = [
  "index.html",
  "privacy.html",
  "support.html",
  "term.html",
  "styles.css",
];

async function copyFileIfExists(fileName) {
  const source = path.join(projectRoot, fileName);
  const target = path.join(distDir, fileName);
  await fs.copyFile(source, target);
}

async function copyAdminOutput() {
  const adminSource = path.join(projectRoot, "admin");
  const adminTarget = path.join(distDir, "admin");
  await fs.cp(adminSource, adminTarget, { recursive: true });
}

async function buildDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  for (const fileName of rootFiles) {
    await copyFileIfExists(fileName);
  }

  await copyAdminOutput();
}

buildDist().catch((error) => {
  console.error("Failed to build dist output:", error);
  process.exitCode = 1;
});

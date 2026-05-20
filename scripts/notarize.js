const { notarize } = require("@electron/notarize");
const path = require("node:path");

require("dotenv").config();

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn("[notarize] Skip notarization: missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Start notarization for ${appName}`);
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId
  });
  console.log("[notarize] Notarization completed");
};


import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * Reads the version of the installed package.
 *
 * @param entryModuleUrl the `import.meta.url` of the entry module, which sits
 *   one directory below the package manifest in both `src` and `build`
 */
export const getPackageVersion = (entryModuleUrl: string): string => {
  const manifestPath = join(
    dirname(fileURLToPath(entryModuleUrl)),
    "../package.json"
  );
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch (error) {
    console.error("Failed to read the package version:", error);
    return "0.0.0";
  }
};

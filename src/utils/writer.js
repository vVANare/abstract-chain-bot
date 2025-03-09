import fs from "fs/promises";
import logger from "./logger.js";
/**
 * Save Privy private key by appending it to existing private key
 */
export async function savePrivyPrivateKey(mutex, filePath, privateKey, privyKey) {
    return await mutex.runExclusive(async () => {
        try {
            // Read the file content
            const content = await fs.readFile(filePath, "utf-8");
            const lines = content.split("\n");
            // Find and update the matching line
            const updatedLines = lines.map((line) => {
                const trimmedLine = line.trim();
                if (trimmedLine === privateKey) {
                    return `${privateKey}:${privyKey}`;
                }
                return line;
            });
            // Write back to file
            await fs.writeFile(filePath, updatedLines.join("\n"));
            logger.success(`Successfully saved privy key for ${privateKey}`);
            return true;
        }
        catch (error) {
            logger.error(`Error saving privy private key: ${error}`);
            return false;
        }
    });
}

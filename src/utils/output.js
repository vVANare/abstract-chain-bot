import figlet from "figlet";
import gradient from "gradient-string";
import logger from "./logger.js";
import chalk from "chalk";
/**
 * Clears the console and displays the STAR LABS logo
 */
export function showLogo() {
    const text = figlet.textSync("ABSTRACT", {
        font: "ANSI Shadow",
        horizontalLayout: "full",
    });
    // Create a cool blue gradient effect
    const logoGradient = gradient([
        { color: "#4169E1", pos: 0 }, // RoyalBlue
        { color: "#1E90FF", pos: 0.3 }, // DodgerBlue
        { color: "#00BFFF", pos: 0.6 }, // DeepSkyBlue
        { color: "#87CEEB", pos: 1 }, // SkyBlue
    ]);
    console.log("\n" + logoGradient(text) + "\n");
}
/**
 * Displays a numbered menu with the provided items
 * @param menuItems - Array of menu items to display
 */
export function showMenu(menuItems) {
    console.clear();
    console.log();
    menuItems.forEach((item, index) => {
        const menuNumber = index + 1;
        const isLastItem = menuNumber === menuItems.length;
        const menuLine = `[${chalk.hex("#4169E1")(menuNumber.toString())}] ${chalk.hex("#1E90FF")(item)}`;
        if (isLastItem) {
            console.log(menuLine + "\n");
        }
        else {
            console.log(menuLine);
        }
    });
}
export function showError(message) {
    logger.error(message);
}
export function showSuccess(message) {
    logger.success(message);
}

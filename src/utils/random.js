import logger from "./logger.js";
export function getRandomRpc(rpcs) {
    return rpcs[Math.floor(Math.random() * rpcs.length)];
}
// Utility functions
export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function randomItemFromArray(array) {
    return array[Math.floor(Math.random() * array.length)];
}
export async function randomSleep(config, task, address) {
    const pause = randomInt(config.settings.random_pause_between_actions[0], config.settings.random_pause_between_actions[1]);
    logger.info(`${address} | Sleeping for ${pause} seconds after ${task}...`);
    await sleep(pause * 1000);
}
/**
 * Generates a random hex string of specified length
 */
export function generateCsrfToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    return token;
}
/**
 * Get a random float between min and max (inclusive)
 * @param min Minimum value
 * @param max Maximum value
 * @returns Random float between min and max
 */
export function getRandomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

import { readConfig } from "./utils/config.js";
import { readTxtFile } from "./utils/reader.js";
import { showLogo } from "./utils/output.js";
import { Mutex } from "async-mutex";
import { reportSuccess, reportError } from "./utils/logs.js";
import { Abstract } from "./model/main.js";
import { randomInt, sleep } from "./utils/random.js";
import logger from "./utils/logger.js";
class Main {
    lock;
    constructor() {
        this.lock = new Mutex();
    }
    async execute() {
        try {
            // Show initial information
            showLogo();
            // Read configuration
            const config = await readConfig();
            config.mutex = this.lock;
            // Read necessary files
            const proxies = await readTxtFile("proxies", "data/proxies.txt");
            const privateKeys = await readTxtFile("private keys", "data/private_keys.txt");
            // Get account range from config
            const startIndex = config.settings.account_range[0];
            const endIndex = config.settings.account_range[1];
            // If both are 0, process all accounts
            const accountsToProcess = startIndex === 0 && endIndex === 0
                ? privateKeys
                : privateKeys.slice(startIndex - 1, endIndex);
            // Get corresponding tokens and proxies for the selected range
            const twitterTokens = await readTxtFile("twitter tokens", "data/twitter_tokens.txt");
            const discordTokens = await readTxtFile("discord tokens", "data/discord_tokens.txt");
            // Get thread count from config
            const threads = config.settings.threads;
            // Validate proxies
            if (proxies.length === 0) {
                logger.error("No proxies found in data/proxies.txt");
                return;
            }
            // Prepare proxy list for selected accounts
            const cycledProxies = accountsToProcess.map((_, i) => proxies[i % proxies.length]);
            logger.info(`Starting with accounts ${startIndex || 1} to ${endIndex || privateKeys.length}...\n`);
            // Create tasks for selected accounts
            const taskFunctions = accountsToProcess.map((privateKey, index) => async () => this.createAccountTask({
                accountIndex: (startIndex || 1) + index,
                proxy: cycledProxies[index],
                privateKey,
                twitterToken: twitterTokens[(startIndex || 1) - 1 + index],
                discordToken: discordTokens[(startIndex || 1) - 1 + index],
                config,
                lock: this.lock,
            }));
            // Run tasks with concurrency limit
            await this.runWithConcurrency(taskFunctions, threads);
            logger.success("Saved accounts and private keys to a file.");
        }
        catch (error) {
            logger.error(`Execution failed: ${error}`);
        }
    }
    async createAccountTask(taskConfig) {
        const { accountIndex, proxy, privateKey, twitterToken, discordToken, config, lock, } = taskConfig;
        try {
            let hasError = false;
            // Parse private keys
            let mainPrivateKey = privateKey;
            let privyPrivateKey = "";
            if (privateKey.includes(":")) {
                const [key1, key2] = privateKey.split(":");
                mainPrivateKey = key1.startsWith("0x") ? key1 : `0x${key1}`;
                privyPrivateKey = key2.startsWith("0x") ? key2 : `0x${key2}`;
            }
            // Initialize instance
            const instance = new Abstract(accountIndex, proxy, mainPrivateKey, privyPrivateKey, twitterToken, discordToken, config);
            logger.info(`Starting account ${accountIndex} with address ${instance.address}`);
            // Initialize instance
            const initResult = await wrapper(() => instance.initialize(), config);
            if (!initResult) {
                hasError = true;
                logger.error(`Account ${accountIndex} initialization failed`);
            }
            await instance.abs();
            // Report results and log to files
            if (hasError) {
                logger.error(`Account ${accountIndex} completed with errors`);
                await reportError(lock, privateKey, proxy, twitterToken);
            }
            else {
                logger.success(`Account ${accountIndex} completed successfully`);
                await reportSuccess(lock, privateKey, proxy, twitterToken);
            }
            // Sleep between accounts
            const pause = randomInt(config.settings.random_pause_between_accounts[0], config.settings.random_pause_between_accounts[1]);
            logger.info(`Sleeping for ${pause} seconds before next account...`);
            await sleep(pause * 1000);
        }
        catch (error) {
            logger.error(`${accountIndex} | Account flow failed: ${error}`);
            await reportError(lock, privateKey, proxy, twitterToken);
        }
    }
    async runWithConcurrency(tasks, concurrency) {
        const results = [];
        const running = new Set();
        for (const task of tasks) {
            const promise = (async () => {
                const result = await task();
                results.push(result);
            })();
            running.add(promise);
            promise.then(() => running.delete(promise));
            if (running.size >= concurrency) {
                await Promise.race(running);
            }
        }
        await Promise.all(running);
        return results;
    }
}
// Start the application using IIFE
(async () => {
    try {
        logger.info("Initializing application...");
        const mainClass = new Main();
        await mainClass.execute();
    }
    catch (error) {
        logger.error(`Fatal error occurred: ${error}`);
        process.exit(1);
    }
})();
/**
 * Wrapper function for retrying operations
 */
async function wrapper(func, config) {
    const attempts = config.settings.attempts;
    for (let attempt = 0; attempt < attempts; attempt++) {
        const result = await func();
        if ((Array.isArray(result) && result[0] === true) || result === true) {
            return result;
        }
        if (attempt < attempts - 1) {
            const pause = randomInt(config.settings.pause_between_attempts[0], config.settings.pause_between_attempts[1]);
            logger.info(`Sleeping for ${pause} seconds before next attempt ${attempt + 1}/${attempts}...`);
            await sleep(pause * 1000);
        }
    }
    return false;
}

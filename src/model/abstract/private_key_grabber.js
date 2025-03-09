import { chromium } from "playwright";
import { sleep } from "../../utils/random.js";
import logger from "../../utils/logger.js";
import path from "path";
import { mkdtemp } from "fs/promises";
import os from "os";
import clipboardy from "clipboardy";
import { randomInt } from "../../utils/random.js";
export class PrivateKeyGrabber {
    accountIndex;
    proxy;
    privateKey;
    config;
    browser = null;
    context = null;
    page = null;
    metamaskLoginPage;
    constructor(accountIndex, proxy = null, privateKey, config) {
        this.accountIndex = accountIndex;
        this.proxy = proxy;
        this.privateKey = privateKey;
        this.config = config;
    }
    async _init() {
        try {
            const metamask = path.resolve("src/utils/metamask_extension");
            const pwTempDir = await mkdtemp(path.join(os.tmpdir(), ""));
            const args = [
                "--disable-blink-features=AutomationControlled",
                `--disable-extensions-except=${metamask}`,
                `--load-extension=${metamask}`,
                "--enable-javascript-harmony",
                "--disable-features=IsolateOrigins,site-per-process",
                "--lang=en-US",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-infobars",
                "--start-maximized",
                "--allow-running-insecure-content",
            ];
            let proxy;
            if (this.proxy) {
                const ok = this.proxy.match(/([^:]+):([^@]+)@(.+)/);
                if (ok) {
                    proxy = {
                        server: `http://${ok[3]}`,
                        username: ok[1],
                        password: ok[2],
                    };
                }
            }
            this.context = await chromium.launchPersistentContext(pwTempDir, {
                headless: !this.config.settings.show_browser_window,
                proxy: proxy,
                locale: "en-US",
                timezoneId: "Europe/Berlin",
                javaScriptEnabled: true,
                channel: "chrome",
                viewport: { width: 1080, height: 920 },
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                args,
            });
            this.page = await this.context.newPage();
            logger.info(`${this.accountIndex} | Browser initialized successfully`);
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | Error initializing browser: ${error}`);
            return false;
        }
    }
    async grabPrivateKey() {
        for (let attempt = 1; attempt <= this.config.settings.attempts; attempt++) {
            try {
                logger.info(`${this.accountIndex} | Attempt ${attempt}/${this.config.settings.attempts} to grab private key`);
                let ok = await this._init();
                if (!ok) {
                    continue;
                }
                await this.page?.goto("https://www.abs.xyz/login");
                await sleep(12000);
                this.metamaskLoginPage = this.context?.pages()[2];
                if (!this.metamaskLoginPage) {
                    logger.error(`${this.accountIndex} | MetaMask page not found, retrying...`);
                    continue;
                }
                ok = await this._loginMetamask();
                if (!ok) {
                    continue;
                }
                ok = await this._loginAbs();
                if (!ok) {
                    continue;
                }
                const privateKey = await this._getPrivateKey();
                if (privateKey) {
                    return privateKey;
                }
            }
            catch (error) {
                logger.error(`${this.accountIndex} | Error grabbing private key (attempt ${attempt}/${this.config.settings.attempts}): ${error}`);
            }
            finally {
                await this.cleanup();
            }
            // If not the last attempt, wait before retrying
            if (attempt < this.config.settings.attempts) {
                const pauseTime = randomInt(this.config.settings.pause_between_attempts[0], this.config.settings.pause_between_attempts[1]);
                logger.info(`${this.accountIndex} | Waiting ${pauseTime} seconds before next attempt...`);
                await sleep(pauseTime * 1000);
            }
        }
        logger.error(`${this.accountIndex} | Failed to grab private key after ${this.config.settings.attempts} attempts`);
        return "";
    }
    async _loginMetamask() {
        try {
            await sleep(4000);
            // Click "Get Started" button
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/ul/li[1]/div/input");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/ul/li[2]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/button[2]");
            await sleep(1000);
            await this.metamaskLoginPage?.fill("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/form/div[1]/label/input", "00000000");
            await this.metamaskLoginPage?.fill("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/form/div[2]/label/input", "00000000");
            // Click through import flow
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/form/div[3]/label/span[1]/input");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/form/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/button[1]");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[2]/div/div/section/div[1]/div/div/label/input");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[2]/div/div/section/div[2]/div/button[2]");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[3]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div/div/div[2]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[1]/div/div[2]/div/div[2]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[3]/div[3]/div/section/div[2]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[3]/div[3]/div/section/div/div[2]/button");
            await sleep(1000);
            await this.metamaskLoginPage?.fill("xpath=/html/body/div[3]/div[3]/div/section/div/div/div[1]/div/input", this.privateKey);
            await sleep(2000);
            await this.metamaskLoginPage?.click("xpath=/html/body/div[3]/div[3]/div/section/div/div/div[2]/button[2]");
            await this.metamaskLoginPage?.close();
            await sleep(1000);
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | Error logging in to metamask: ${error}`);
            return false;
        }
    }
    async _loginAbs() {
        for (let attempt = 1; attempt <= this.config.settings.attempts; attempt++) {
            try {
                await this.page?.reload();
                await sleep(3000);
                // Click "Login with Wallet"
                await this.page?.click('button:has-text("Login with Wallet")');
                await sleep(2000);
                // Click "MetaMask"
                await this.page?.click('button:has-text("MetaMask")');
                await sleep(7000);
                this.metamaskLoginPage = this.context?.pages()[2];
                await this.metamaskLoginPage?.click('xpath=//*[@id="app-content"]/div/div/div/div[2]/div/div[3]/div/div[2]/button[2]');
                await sleep(6000);
                this.metamaskLoginPage = this.context?.pages()[2];
                await this.metamaskLoginPage?.click('xpath=//*[@id="app-content"]/div/div/div/div/div[3]/button[2]');
                await sleep(10000);
                for (let i = 0; i < 2; i++) {
                    try {
                        await this.page?.click(`xpath=//*[@id="modal-root"]/aside/div[2]/section/div/div[1]/button`, { timeout: 10000 });
                    }
                    catch { }
                }
                // Check if we're redirected to the wallet page
                const currentUrl = this.page?.url();
                if (currentUrl !== "https://www.abs.xyz/wallet") {
                    logger.error(`${this.accountIndex} | Failed to reach wallet page, current URL: ${currentUrl}`);
                    continue;
                }
                logger.success(`${this.accountIndex} | Successfully logged in to abs`);
                return true;
            }
            catch (error) {
                logger.error(`${this.accountIndex} | Error logging in to abs: ${error}`);
                continue;
            }
        }
        return false;
    }
    async _getPrivateKey() {
        try {
            await this.page?.goto("https://www.abs.xyz/profile");
            await sleep(3000);
            // Click Security tab
            await this.page?.click('h3:has-text("Security")');
            await sleep(2000);
            // Click Export button
            await this.page?.click('button:has-text("Export")');
            await sleep(2000);
            // Confirm export
            await this.page?.click('button:has-text("Yes, export")');
            await sleep(5000);
            // Click Copy Key button and get clipboard content
            for (let i = 0; i < 4; i++) {
                await this.page?.keyboard.press("Tab");
                await sleep(1000);
            }
            await this.page?.keyboard.press("Enter");
            await sleep(1000);
            const privateKey = clipboardy.readSync();
            if (privateKey) {
                logger.info(`${this.accountIndex} | Successfully got private key: 0x${privateKey}`);
                return "0x" + privateKey;
            }
            else {
                return "";
            }
        }
        catch (error) {
            logger.error(`${this.accountIndex} | Error getting private key: ${error}`);
            return "";
        }
    }
    async cleanup() {
        if (this.page)
            await this.page.close();
        if (this.context)
            await this.context.close();
        if (this.browser)
            await this.browser.close();
    }
}

import { ethers } from "ethers";
import { Client } from "../utils/client.js";
import logger from "../utils/logger.js";
import { AbstractAccount } from "./abstract/account.js";
import { getRandomRpc } from "../utils/random.js";
export class Abstract {
    accountIndex;
    proxy;
    privateKey;
    privyPrivateKey;
    twitterToken;
    discordToken;
    config;
    wallet;
    address;
    client = null;
    provider;
    constructor(accountIndex, proxy, privateKey, privyPrivateKey, twitterToken, discordToken, config) {
        this.accountIndex = accountIndex;
        this.proxy = proxy;
        this.privateKey = privateKey;
        this.privyPrivateKey = privyPrivateKey;
        this.twitterToken = twitterToken;
        this.discordToken = discordToken;
        this.config = config;
        this.wallet = new ethers.Wallet(privateKey);
        this.address = this.wallet.address;
        this.provider = new ethers.JsonRpcProvider(getRandomRpc(config.rpcs.arbitrum_rpc));
    }
    async initialize() {
        try {
            this.client = new Client(this.proxy);
            await this.client.init();
            return true;
        }
        catch (error) {
            logger.error(`${this.address} | Error initializing client: ${error}`);
            return false;
        }
    }
    async cleanup() {
        if (this.client) {
            this.client = null;
        }
    }
    async abs() {
        try {
            if (!this.client) {
                throw new Error("Client not initialized");
            }
            const absClient = new AbstractAccount(this.accountIndex, this.proxy, this.privateKey, this.privyPrivateKey, this.twitterToken, this.discordToken, this.config, this.client);
            let ok = await absClient.login();
            if (!ok) {
                return false;
            }
            if (this.config.abs.tasks.includes("connect_socials")) {
                await absClient.connectSocials();
            }
            if (this.config.abs.tasks.includes("swaps")) {
                await absClient.swaps();
            }
            // if (this.config.abs.tasks.includes("myriad")) {
            //     await absClient.myriad();
            // }
            if (this.config.abs.tasks.includes("votes")) {
                await absClient.votes();
            }
            if (this.config.abs.tasks.includes("badges")) {
                await absClient.badges();
            }
            if (this.config.abs.tasks.includes("collect_all_to_eth")) {
                await absClient.collectAllToEth();
            }
            if (this.config.abs.tasks.includes("logs")) {
                await absClient.collectAllData();
            }
            return true;
        }
        catch (error) {
            logger.error(`${this.address} | Error in abs execution: ${error}`);
            return false;
        }
        finally {
            await this.cleanup();
        }
    }
}

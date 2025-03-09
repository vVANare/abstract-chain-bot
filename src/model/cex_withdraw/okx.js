import ccxt from "ccxt";
import logger from "../../utils/logger.js";
import { ethers } from "ethers";
export class OKXWithdraw {
    accountIndex;
    privateKey;
    config;
    exchange;
    wallet;
    address;
    constructor(accountIndex, privateKey, config) {
        this.accountIndex = accountIndex;
        this.privateKey = privateKey;
        this.config = config;
        // Initialize OKX exchange
        this.exchange = new ccxt.okx({
            apiKey: this.config.withdraw.api_key,
            secret: this.config.withdraw.secret_key,
            password: this.config.withdraw.password,
            enableRateLimit: true,
        });
        this.wallet = new ethers.Wallet(privateKey);
        this.address = this.wallet.address;
    }
    /**
     * Withdraw ETH from OKX using config settings
     * @returns Withdrawal transaction details
     */
    async withdraw() {
        try {
            logger.info(`${this.accountIndex} | ${this.address} | Starting OKX withdrawal`);
            // Get initial balance
            const provider = new ethers.JsonRpcProvider(this.config.rpcs.arbitrum_rpc[0]);
            const initialBalance = await provider.getBalance(this.address);
            logger.info(`${this.accountIndex} | ${this.address} | Initial balance: ${ethers.formatEther(initialBalance)} ETH`);
            // Get random amount from config range
            const amount = this.getRandomAmount();
            // Execute withdrawal with fee parameter
            const withdrawal = await this.exchange.withdraw("ETH", // code
            amount, // amount
            this.address, // address
            undefined, // tag
            {
                network: "Arbitrum One", // OKX requires "Arbitrum One" as the network name
                fee: "0.0001", // Required fee parameter for OKX
            });
            logger.success(`${this.accountIndex} | ${this.address} | Successfully withdrew from OKX! Waiting for deposit...`);
            // Wait for deposit to be received (max 7 minutes)
            const maxAttempts = 42; // 42 attempts * 10 seconds = 7 minutes
            let attempts = 0;
            const SECONDS_PER_ATTEMPT = 10;
            const LOG_INTERVAL = 30; // seconds
            const ATTEMPTS_PER_LOG = LOG_INTERVAL / SECONDS_PER_ATTEMPT;
            while (attempts < maxAttempts) {
                const currentBalance = await provider.getBalance(this.address);
                if (currentBalance > initialBalance) {
                    const received = ethers.formatEther(currentBalance - initialBalance);
                    logger.success(`${this.accountIndex} | ${this.address} | Deposit received: ${received} ETH`);
                    return true;
                }
                attempts++;
                if (attempts === maxAttempts) {
                    logger.error(`${this.accountIndex} | ${this.address} | Deposit not received after 7 minutes`);
                    return false;
                }
                if (attempts % ATTEMPTS_PER_LOG === 0) {
                    const minutesWaited = (attempts * SECONDS_PER_ATTEMPT) / 60;
                    logger.info(`${this.accountIndex} | ${this.address} | Waiting for deposit... ${minutesWaited.toFixed(1)} minutes`);
                }
                await new Promise((resolve) => setTimeout(resolve, SECONDS_PER_ATTEMPT * 1000));
            }
            await this.exchange.close();
            // console.log("CLOSED");
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error withdrawing from OKX: ${error}`);
            return false;
        }
    }
    getRandomAmount() {
        const [min, max] = this.config.withdraw.amount;
        return Math.random() * (max - min) + min;
    }
}

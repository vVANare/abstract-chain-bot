import { ethers } from "ethers";
import { ABS_BADGE_CONTRACT, ABS_VOTE_CONTRACT, EXPLORER_URL, PRIVY_APP_ID, PRIVY_CLIENT_ID, SWAP_TOKENS, } from "./constants.js";
import { getRandomRpc, randomItemFromArray, generateCsrfToken, sleep, } from "../../utils/random.js";
import logger from "../../utils/logger.js";
import crypto, { randomInt } from "crypto";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import fs from "fs";
import { BitgetWithdraw } from "../cex_withdraw/bitget.js";
import { OKXWithdraw } from "../cex_withdraw/okx.js";
import { RelayBridge } from "../bridges/relay.js";
import { savePrivyPrivateKey } from "../../utils/writer.js";
import { PrivateKeyGrabber } from "./private_key_grabber.js";
import { saveProgress } from "../../utils/logs.js";
// Add token symbol mapping at the top with other constants
const TOKEN_SYMBOL_MAPPING = {
    "USDC.e": "USDC",
    // Add other mappings if needed
};
export class AbstractAccount {
    accountIndex;
    proxy;
    privateKey;
    privyPrivateKey;
    twitterToken;
    discordToken;
    config;
    httpClient;
    wallet;
    provider;
    address;
    abstractAccount;
    loginTokens = {
        bearer_token: "",
        privy_access_token: "",
        refresh_token: "",
        identity_token: "",
        userLogin: "",
    };
    embeddedWalletAddress = "";
    constructor(accountIndex, proxy, privateKey, privyPrivateKey, twitterToken, discordToken, config, httpClient) {
        this.accountIndex = accountIndex;
        this.proxy = proxy;
        this.privateKey = privateKey;
        this.privyPrivateKey = privyPrivateKey;
        this.twitterToken = twitterToken;
        this.discordToken = discordToken;
        this.config = config;
        this.httpClient = httpClient;
        // Initialize provider
        this.provider = new ethers.JsonRpcProvider(getRandomRpc(config.rpcs.abstract_rpc));
        // Initialize wallet with provider
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.address = this.wallet.address;
    }
    // Add helper function at the top level of the class
    async retryOperation(operation, actionName) {
        for (let attempt = 1; attempt <= this.config.settings.attempts; attempt++) {
            try {
                const result = await operation();
                if (result) {
                    if (attempt > 1) {
                        logger.success(`${this.accountIndex} | ${this.address} | ${actionName} succeeded on attempt ${attempt}`);
                    }
                    return true;
                }
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | ${actionName} attempt ${attempt} failed: ${error}`);
            }
            if (attempt < this.config.settings.attempts) {
                logger.info(`${this.accountIndex} | ${this.address} | Retrying ${actionName} (attempt ${attempt + 1}/${this.config.settings.attempts})`);
                await sleep(5000); // Wait 5 seconds between retries
            }
        }
        logger.error(`${this.accountIndex} | ${this.address} | ${actionName} failed after ${this.config.settings.attempts} attempts`);
        return false;
    }
    /**
     * Main login flow
     */
    async login() {
        try {
            if (this.privyPrivateKey === "") {
                const grabber = new PrivateKeyGrabber(this.accountIndex, this.proxy, this.privateKey, this.config);
                this.privyPrivateKey = await grabber.grabPrivateKey();
                if (this.privyPrivateKey === "") {
                    logger.error(`${this.address} | Error grabbing private key`);
                    return false;
                }
                else {
                    if (!this.config.mutex) {
                        logger.error(`${this.address} | Mutex is not initialized`);
                        return false;
                    }
                    await savePrivyPrivateKey(this.config.mutex, "data/private_keys.txt", this.privateKey, this.privyPrivateKey);
                    logger.success(`${this.address} | Privy private key saved - ${this.privyPrivateKey}. Waiting for 30 seconds after the registration...`);
                    await sleep(30000);
                }
            }
            const nonce = await this._getNonce();
            const date = new Date();
            const currentTime = date.getUTCFullYear() +
                "-" +
                String(date.getUTCMonth() + 1).padStart(2, "0") +
                "-" +
                String(date.getUTCDate()).padStart(2, "0") +
                "T" +
                String(date.getUTCHours()).padStart(2, "0") +
                ":" +
                String(date.getUTCMinutes()).padStart(2, "0") +
                ":" +
                String(date.getUTCSeconds()).padStart(2, "0") +
                ".604Z";
            const signatureText = `www.abs.xyz wants you to sign in with your Ethereum account:\n` +
                `${this.address}\n\n` +
                `By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.\n\n` +
                `URI: https://www.abs.xyz\n` +
                `Version: 1\n` +
                `Chain ID: 2741\n` +
                `Nonce: ${nonce}\n` +
                `Issued At: ${currentTime}\n` +
                `Resources:\n` +
                `- https://privy.io`;
            const signature = await this.wallet.signMessage(signatureText);
            const headers = {
                accept: "application/json",
                origin: "https://www.abs.xyz",
                "privy-app-id": PRIVY_APP_ID,
                "privy-client-id": PRIVY_CLIENT_ID,
                referer: "https://www.abs.xyz/",
            };
            const jsonData = {
                message: signatureText,
                signature,
                chainId: "eip155:2741",
                walletClientType: "metamask",
                connectorType: "injected",
                mode: "login-or-sign-up",
            };
            // Make the actual authentication request
            const response = await this.httpClient.post("https://auth.privy.io/api/v1/siwe/authenticate", { headers, json: jsonData });
            if (!response.ok) {
                const text = await response.text();
                if (text.includes("Too Many Requests")) {
                    logger.error(`${this.accountIndex} | ${this.address} | ABS is shitting its pants, trying again...`);
                    return false;
                }
                throw new Error(`Failed to login: ${await response.text()}`);
            }
            const data = await response.json();
            this.loginTokens = {
                ...this.loginTokens,
                bearer_token: data.token,
                privy_access_token: data.privy_access_token,
                refresh_token: data.refresh_token,
                identity_token: data.identity_token,
            };
            if (data.is_new_user) {
                logger.success(`${this.accountIndex} | ${this.address} | Successfully registered new account!`);
            }
            else {
                logger.success(`${this.accountIndex} | ${this.address} | Successfully logged in!`);
            }
            if (!(await this._refreshSession())) {
                return false;
            }
            if (!(await this._refreshSession())) {
                return false;
            }
            const userInfo = await this._getUserInfo();
            this.embeddedWalletAddress = userInfo.user.walletAddress;
            try {
                // Initialize Abstract Account client
                // Ensure private key is in correct format for viem
                const formattedPrivyKey = this.privyPrivateKey.startsWith("0x")
                    ? this.privyPrivateKey
                    : `0x${this.privyPrivateKey}`;
                // Create signer account
                const agwSigner = privateKeyToAccount(formattedPrivyKey);
                this.abstractAccount = await createAbstractClient({
                    signer: agwSigner,
                    chain: abstract,
                    transport: http(),
                });
                logger.success(`${this.accountIndex} | ${this.address} | Successfully initialized Abstract Account`);
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | Error initializing Abstract Account: ${error}`);
                return false;
            }
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error login abs: ${error}`);
            return false;
        }
    }
    // Helper function to format balances for logging
    formatBalances(balances) {
        return balances
            .map((b) => `${b.symbol}: ${b.decimalBalance} ($${b.usdValue.toFixed(2)})`)
            .join(" | ");
    }
    async collectAllToEth() {
        return await this.retryOperation(async () => {
            try {
                // Get current balances
                const balances = await this._getAbsWalletBalances();
                if (!balances || balances.length === 0) {
                    logger.info(`${this.accountIndex} | ${this.address} | No tokens to collect to ETH`);
                    return true;
                }
                logger.info(`${this.accountIndex} | ${this.address} | Current balances: ${this.formatBalances(balances)}`);
                // Filter out ETH and tokens with zero balance
                const tokensToSwap = balances.filter((b) => b.symbol !== "ETH" &&
                    b.symbol !== "WETH" &&
                    parseFloat(b.decimalBalance) > 0);
                if (tokensToSwap.length === 0) {
                    logger.info(`${this.accountIndex} | ${this.address} | No tokens to swap to ETH`);
                    return true;
                }
                // Swap each token to ETH
                for (const token of tokensToSwap) {
                    let success = false;
                    for (let attempt = 0; attempt < 3 && !success; attempt++) {
                        try {
                            // Calculate amount (100% of balance)
                            const swapPercent = 100;
                            const amountToSwap = (BigInt(token.rawBalance) *
                                BigInt(swapPercent)) /
                                BigInt(100);
                            // Get origin token address from SWAP_TOKENS using symbol
                            const mappedSymbol = TOKEN_SYMBOL_MAPPING[token.symbol] ||
                                token.symbol;
                            const originTokenAddress = SWAP_TOKENS[mappedSymbol];
                            if (!originTokenAddress) {
                                logger.error(`${this.accountIndex} | ${this.address} | Could not find address for token ${token.symbol} (mapped: ${mappedSymbol})`);
                                continue;
                            }
                            // Log swap details
                            logger.info(`${this.accountIndex} | ${this.address} | Swapping ${swapPercent}% (${ethers.formatUnits(amountToSwap, token.decimals)} ${token.symbol}) to ETH`);
                            const jsonData = {
                                user: this.embeddedWalletAddress,
                                destinationCurrency: SWAP_TOKENS["ETH"],
                                destinationChainId: 2741,
                                originCurrency: originTokenAddress,
                                originChainId: 2741,
                                amount: amountToSwap.toString(),
                                recipient: this.embeddedWalletAddress,
                                tradeType: "EXACT_INPUT",
                                referrer: "abstract",
                                slippageTolerance: "50",
                            };
                            const response = await this.httpClient.post("https://api.relay.link/quote", { json: jsonData });
                            const responseData = await response.json();
                            // Handle API error response
                            if (responseData.message) {
                                throw new Error(responseData.message);
                            }
                            if (!responseData.steps) {
                                throw new Error("No steps in response");
                            }
                            const steps = responseData.steps;
                            let transactions = [];
                            for (const step of steps) {
                                transactions.push(step.items[0].data);
                            }
                            let txHash;
                            for (const transaction of transactions) {
                                // Remove gasPrice and format transaction for abstractClient
                                const formattedTransaction = {
                                    to: transaction.to,
                                    value: BigInt(transaction.value || 0), // Convert to BigInt, default to 0 if undefined
                                    data: transaction.data,
                                };
                                // Send transaction with correct format
                                txHash =
                                    await this.abstractAccount.sendTransaction(formattedTransaction);
                                await sleep(2000);
                            }
                            if (txHash) {
                                success = true;
                                logger.success(`${this.accountIndex} | ${this.address} | Successfully swapped ${token.symbol} to ETH: ${EXPLORER_URL}/tx/${txHash}`);
                                // Wait for the swap to be processed
                                await sleep(5000);
                                // Get and log updated balances
                                const updatedBalances = await this._getAbsWalletBalances();
                                if (updatedBalances) {
                                    logger.info(`${this.accountIndex} | ${this.address} | Current balances: ${this.formatBalances(updatedBalances)}`);
                                }
                                // Add pause between swaps
                                const pauseTime = randomInt(this.config.settings
                                    .random_pause_between_swaps[0], this.config.settings
                                    .random_pause_between_swaps[1]);
                                logger.info(`${this.accountIndex} | ${this.address} | Waiting ${pauseTime} seconds before next swap...`);
                                await sleep(pauseTime * 1000);
                                break;
                            }
                        }
                        catch (error) {
                            if (attempt < 2) {
                                logger.error(`${this.accountIndex} | ${this.address} | Swap attempt ${attempt + 1} failed, retrying... Error: ${error}`);
                                await sleep(2000);
                            }
                            else {
                                logger.error(`${this.accountIndex} | ${this.address} | All swap attempts failed for ${token.symbol}. Error: ${error}`);
                            }
                        }
                    }
                }
                // Get final balances
                const finalBalances = await this._getAbsWalletBalances();
                if (finalBalances) {
                    logger.info(`${this.accountIndex} | ${this.address} | Final balances after collecting to ETH: ${this.formatBalances(finalBalances)}`);
                }
                return true;
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | Error collect all to eth: ${error}`);
                return false;
            }
        }, "Collect all to eth");
    }
    async swaps() {
        return await this.retryOperation(async () => {
            try {
                // Initial balance check
                const initialBalances = await this._getAbsWalletBalances();
                if (!initialBalances || initialBalances.length === 0) {
                    logger.info(`${this.accountIndex} | ${this.address} | No tokens found in Abstract wallet, initiating bridge...`);
                    // Check and bridge ETH if needed
                    const result = await this._bridge();
                    if (!result) {
                        logger.error(`${this.accountIndex} | ${this.address} | Failed to bridge ETH to Abstract`);
                        return false;
                    }
                    const newBalances = await this._getAbsWalletBalances();
                    if (!newBalances || newBalances.length === 0) {
                        logger.error(`${this.accountIndex} | ${this.address} | Still no tokens after bridge`);
                        return false;
                    }
                }
                logger.info(`${this.accountIndex} | ${this.address} | Initial balances: ${this.formatBalances(initialBalances)}`);
                const numberOfSwaps = randomInt(this.config.abs.number_of_swaps[0], this.config.abs.number_of_swaps[1] + 1);
                logger.info(`${this.accountIndex} | ${this.address} | Will try to perform ${numberOfSwaps} swaps`);
                for (let swapCount = 0; swapCount < numberOfSwaps; swapCount++) {
                    let success = false;
                    for (let attempt = 0; attempt < 3 && !success; attempt++) {
                        try {
                            let balances = await this._getAbsWalletBalances();
                            if (!balances) {
                                continue;
                            }
                            // Find token with highest USD value
                            const highestBalanceToken = balances.reduce((max, current) => {
                                return current.usdValue > max.usdValue
                                    ? current
                                    : max;
                            }, balances[0]);
                            if (highestBalanceToken.usdValue <
                                this.config.abs.minimal_usd_balance) {
                                // Add a small delay before checking Arbitrum balance
                                await sleep(5000);
                                // Check Arbitrum balance
                                const randomRpc = getRandomRpc(this.config.rpcs.arbitrum_rpc);
                                const arbitrumProvider = new ethers.JsonRpcProvider(randomRpc);
                                const arbitrumBalance = await arbitrumProvider.getBalance(this.address);
                                logger.info(`${this.accountIndex} | ${this.address} | Current Arbitrum balance: ${ethers.formatEther(arbitrumBalance)} ETH`);
                                const minRequired = ethers.parseEther(this.config.bridge.eth_to_bridge[0].toString());
                                if (arbitrumBalance < minRequired) {
                                    if (!this.config.withdraw.withdraw_enabled) {
                                        logger.info(`${this.accountIndex} | ${this.address} | Withdrawals are disabled in config, skipping...`);
                                        continue;
                                    }
                                    const result = await this._bridge();
                                    if (!result) {
                                        continue;
                                    }
                                }
                                else {
                                    // If Arbitrum balance is sufficient, proceed with bridge directly
                                    logger.info(`${this.accountIndex} | ${this.address} | Arbitrum balance is sufficient, proceeding with bridge...`);
                                    // Calculate safe amount to bridge (95% of balance or max from config, whichever is lower)
                                    const maxFromConfig = ethers.parseEther(this.config.bridge.eth_to_bridge[1].toString());
                                    const safeBalance = (arbitrumBalance * BigInt(95)) /
                                        BigInt(100);
                                    const maxToUse = safeBalance < maxFromConfig
                                        ? safeBalance
                                        : maxFromConfig;
                                    // Calculate random amount between min and max
                                    const minEth = ethers.parseEther(this.config.bridge.eth_to_bridge[0].toString());
                                    const randomAmount = minEth +
                                        BigInt(Math.floor(Math.random() *
                                            Number(maxToUse - minEth)));
                                    logger.info(`${this.accountIndex} | ${this.address} | Will bridge ${ethers.formatEther(randomAmount)} ETH`);
                                    const ok = await this._executeBridge(randomAmount);
                                    if (!ok) {
                                        continue;
                                    }
                                }
                            }
                            // Get available tokens for swapping, excluding the highest balance token
                            const availableTokens = Object.entries(SWAP_TOKENS).filter(([symbol]) => {
                                // Handle USDC.e mapping
                                const mappedSymbol = TOKEN_SYMBOL_MAPPING[highestBalanceToken.symbol] || highestBalanceToken.symbol;
                                return symbol !== mappedSymbol;
                            });
                            if (availableTokens.length === 0) {
                                logger.error(`${this.accountIndex} | ${this.address} | No available tokens for swapping`);
                                continue;
                            }
                            // Select random token from available tokens that's not the current highest balance token
                            let selectedToken;
                            do {
                                selectedToken = await randomItemFromArray(availableTokens);
                            } while (selectedToken[0] === highestBalanceToken.symbol);
                            const toTokenSymbol = selectedToken[0];
                            const toTokenAddress = selectedToken[1];
                            // Get origin token address from SWAP_TOKENS using symbol
                            const mappedSymbol = TOKEN_SYMBOL_MAPPING[highestBalanceToken.symbol] || highestBalanceToken.symbol;
                            const originTokenAddress = SWAP_TOKENS[mappedSymbol];
                            if (!originTokenAddress) {
                                logger.error(`${this.accountIndex} | ${this.address} | Could not find address for token ${highestBalanceToken.symbol} (mapped: ${mappedSymbol})`);
                                continue;
                            }
                            const randomPercent = randomInt(this.config.abs.balance_percent_to_swap[0], this.config.abs.balance_percent_to_swap[1]);
                            const amountToSwap = (BigInt(highestBalanceToken.rawBalance) *
                                BigInt(randomPercent)) /
                                BigInt(100);
                            // Log swap details in one line
                            logger.info(`${this.accountIndex} | ${this.address} | Swapping ${randomPercent}% (${ethers.formatUnits(amountToSwap, highestBalanceToken.decimals)} ${highestBalanceToken.symbol}) to ${toTokenSymbol}`);
                            const jsonData = {
                                user: this.embeddedWalletAddress,
                                destinationCurrency: toTokenAddress,
                                destinationChainId: 2741,
                                originCurrency: originTokenAddress,
                                originChainId: 2741,
                                amount: amountToSwap.toString(),
                                recipient: this.embeddedWalletAddress,
                                tradeType: "EXACT_INPUT",
                                referrer: "abstract",
                                slippageTolerance: "50",
                            };
                            const response = await this.httpClient.post("https://api.relay.link/quote", { json: jsonData });
                            const responseData = await response.json();
                            const steps = responseData.steps;
                            let transactions = [];
                            for (const step of steps) {
                                transactions.push(step.items[0].data);
                            }
                            let txHash;
                            for (const transaction of transactions) {
                                // Remove gasPrice and format transaction for abstractClient
                                const formattedTransaction = {
                                    to: transaction.to,
                                    value: BigInt(transaction.value || 0), // Convert to BigInt, default to 0 if undefined
                                    data: transaction.data,
                                };
                                // Send transaction with correct format
                                txHash =
                                    await this.abstractAccount.sendTransaction(formattedTransaction);
                                await sleep(2000);
                            }
                            if (txHash) {
                                success = true;
                                logger.success(`${this.accountIndex} | ${this.address} | Swap ${swapCount + 1}/${numberOfSwaps} successful: ${EXPLORER_URL}/tx/${txHash}`);
                                // Wait a bit for the swap to be processed
                                await sleep(5000);
                                // Get and log updated balances after swap
                                const updatedBalances = await this._getAbsWalletBalances();
                                if (updatedBalances) {
                                    logger.info(`${this.accountIndex} | ${this.address} | Updated balances after swap ${swapCount + 1}: ${this.formatBalances(updatedBalances)}`);
                                }
                                // Add random pause between swaps if this isn't the last swap
                                if (swapCount < numberOfSwaps - 1) {
                                    const pauseTime = randomInt(this.config.settings
                                        .random_pause_between_swaps[0], this.config.settings
                                        .random_pause_between_swaps[1]);
                                    logger.info(`${this.accountIndex} | ${this.address} | Waiting ${pauseTime} seconds before next swap...`);
                                    await sleep(pauseTime * 1000);
                                }
                                break;
                            }
                        }
                        catch (error) {
                            if (attempt < 2) {
                                logger.error(`${this.accountIndex} | ${this.address} | Swap attempt ${attempt + 1} failed, retrying... Error: ${error}`);
                                await sleep(2000); // Wait before retry
                            }
                            else {
                                logger.error(`${this.accountIndex} | ${this.address} | All swap attempts failed for swap ${swapCount + 1}/${numberOfSwaps}. Error: ${error}`);
                            }
                        }
                    }
                    if (!success) {
                        logger.error(`${this.accountIndex} | ${this.address} | Failed to perform swap ${swapCount + 1}/${numberOfSwaps} after 3 attempts`);
                        return false;
                    }
                }
                // Get and log final balances
                const finalBalances = await this._getAbsWalletBalances();
                if (finalBalances) {
                    logger.info(`${this.accountIndex} | ${this.address} | Final balances after all swaps: ${this.formatBalances(finalBalances)}`);
                }
                return true;
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | Error in swaps: ${error}`);
                return false;
            }
        }, "Swaps");
    }
    async badges() {
        return await this.retryOperation(async () => {
            try {
                const pauseTime = randomInt(this.config.settings.pause_before_claiming_badges[0], this.config.settings.pause_before_claiming_badges[1]);
                logger.info(`${this.accountIndex} | ${this.address} | Waiting ${pauseTime} seconds before claiming badges...`);
                await sleep(pauseTime * 1000);
                const userInfo = await this._getUserInfo();
                const badges = userInfo.user.badges;
                if (badges.length === 0) {
                    logger.info(`${this.accountIndex} | ${this.address} | No available badges for claiming`);
                    return true;
                }
                for (const badge of badges) {
                    if (!badge.claimed) {
                        logger.info(`${this.accountIndex} | ${this.address} | Claiming badge: ${badge.badge.name}`);
                        const badgeABI = JSON.parse(fs.readFileSync("src/abis/absBadgeAbi.json", "utf8"));
                        const contract = new ethers.Interface(badgeABI);
                        const response = await this.httpClient.post(`https://backend.portal.abs.xyz/api/badge/${badge.badge.id.toString()}/claim`, {
                            headers: {
                                accept: "application/json, text/plain, */*",
                                authorization: `Bearer ${this.loginTokens.bearer_token}`,
                                origin: "https://www.abs.xyz",
                                referer: "https://www.abs.xyz/",
                                "x-privy-token": this.loginTokens.identity_token,
                            },
                            json: {},
                        });
                        if (!response.ok) {
                            throw new Error(`Failed to claim badge: ${await response.text()}`);
                        }
                        const data = await response.json();
                        const signature = data.signature;
                        logger.info(`${this.accountIndex} | ${this.address} | Minting badge to address: ${this.embeddedWalletAddress}`);
                        const encodedBadgeData = contract.encodeFunctionData("mintBadge", [
                            this.embeddedWalletAddress,
                            badge.badge.id,
                            signature,
                        ]);
                        const transaction = {
                            to: ABS_BADGE_CONTRACT,
                            data: encodedBadgeData,
                            value: 0,
                        };
                        const txHash = await this.abstractAccount.sendTransaction(transaction);
                        if (txHash) {
                            logger.success(`${this.accountIndex} | ${this.address} | Successfully minted ${badge.badge.name} | https://abscan.org/tx/${txHash}`);
                            const pauseTime = randomInt(this.config.settings
                                .random_pause_between_badges_mint[0], this.config.settings.random_pause_between_badges_mint[1]);
                            logger.info(`${this.accountIndex} | ${this.address} | Waiting ${pauseTime} seconds before minting next badge...`);
                            await sleep(pauseTime * 1000);
                        }
                    }
                }
                return true;
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | Error badges: ${error}`);
                return false;
            }
        }, "Badges");
    }
    /**
     * Connect social accounts
     */
    async connectSocials() {
        return await this.retryOperation(async () => {
            try {
                let connectDiscord = true;
                let connectTwitter = true;
                let success = true;
                const userInfo = await this._getUserInfo();
                const socials = userInfo.user.socials;
                for (const [social, username] of Object.entries(socials)) {
                    if (social === "discord") {
                        logger.success(`${this.accountIndex} | ${this.address} | Discord ${username} already connected!`);
                        connectDiscord = false;
                    }
                    else if (social === "twitter") {
                        logger.success(`${this.accountIndex} | ${this.address} | Twitter ${username} already connected!`);
                        connectTwitter = false;
                    }
                }
                if (connectDiscord) {
                    if (!(await this._connectDiscord())) {
                        success = false;
                    }
                }
                // Commented out as in the Python code
                if (connectTwitter) {
                    if (!(await this._connectTwitter())) {
                        success = false;
                    }
                }
                return success;
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | Error connect socials: ${error}`);
                return false;
            }
        }, "Connect socials");
    }
    // Update the votes method to use _getMyVotes
    async votes() {
        try {
            const numberOfVotes = randomInt(this.config.abs.number_of_votes[0], this.config.abs.number_of_votes[1] + 1);
            logger.info(`${this.accountIndex} | ${this.address} | Will perform ${numberOfVotes} votes`);
            for (let voteCount = 0; voteCount < numberOfVotes; voteCount++) {
                const success = await this.retryOperation(async () => {
                    try {
                        const myVotes = await this._getMyVotes();
                        if (!myVotes) {
                            logger.error(`${this.accountIndex} | ${this.address} | Failed to get voted apps`);
                            return false;
                        }
                        let page = 1;
                        let allApps = [];
                        while (true) {
                            const response = await this.httpClient.get(`https://backend.portal.abs.xyz/api/app?page=${page}&limit=20&category=`, {
                                headers: {
                                    accept: "application/json, text/plain, */*",
                                    authorization: `Bearer ${this.loginTokens.bearer_token}`,
                                    origin: "https://www.abs.xyz",
                                    referer: "https://www.abs.xyz/",
                                    "x-privy-token": this.loginTokens.identity_token,
                                },
                            });
                            const data = await response.json();
                            const apps = data.items.map((item) => ({
                                id: item.id,
                                name: item.name,
                            }));
                            allApps = [...allApps, ...apps];
                            if (data.pagination.totalPages === page) {
                                break;
                            }
                            page++;
                        }
                        logger.info(`${this.accountIndex} | ${this.address} | Already voted apps: ${myVotes}`);
                        const unvotedApps = allApps.filter((app) => !myVotes.includes(Number(app.id)));
                        logger.info(`${this.accountIndex} | ${this.address} | Found ${unvotedApps.length} unvoted apps`);
                        if (unvotedApps.length === 0) {
                            logger.info(`${this.accountIndex} | ${this.address} | No more apps to vote for`);
                            return true;
                        }
                        const randomApp = await randomItemFromArray(unvotedApps);
                        logger.info(`${this.accountIndex} | ${this.address} | Vote ${voteCount + 1}/${numberOfVotes} | Voting for ${randomApp.name} | ID: ${randomApp.id}`);
                        const voteABI = JSON.parse(fs.readFileSync("src/abis/absVoteAbi.json", "utf8"));
                        const contractInterface = new ethers.Interface(voteABI);
                        const encodedTransactionData = contractInterface.encodeFunctionData("voteForApp", [
                            randomApp.id,
                        ]);
                        const transaction = {
                            to: ABS_VOTE_CONTRACT,
                            data: encodedTransactionData,
                            value: 0,
                        };
                        const txHash = await this.abstractAccount.sendTransaction(transaction);
                        if (txHash) {
                            logger.success(`${this.accountIndex} | ${this.address} | Vote ${voteCount + 1}/${numberOfVotes} successful for ${randomApp.name} | TX: ${EXPLORER_URL}${txHash}`);
                            // Add pause between votes if this isn't the last vote
                            if (voteCount < numberOfVotes - 1) {
                                const pauseTime = randomInt(this.config.settings
                                    .random_pause_between_actions[0], this.config.settings
                                    .random_pause_between_actions[1]);
                                logger.info(`${this.accountIndex} | ${this.address} | Waiting ${pauseTime} seconds before next vote...`);
                                await sleep(pauseTime * 1000);
                            }
                            return true;
                        }
                        return false;
                    }
                    catch (error) {
                        logger.error(`${this.accountIndex} | ${this.address} | Error voting for app: ${error}`);
                        return false;
                    }
                }, `Vote ${voteCount + 1}/${numberOfVotes}`);
                if (!success) {
                    return false;
                }
            }
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error votes: ${error}`);
            return false;
        }
    }
    async withdraw() {
        try {
            if (this.config.withdraw.cex === "okx") {
                const withdrawal = new OKXWithdraw(this.accountIndex, this.privateKey, this.config);
                return await withdrawal.withdraw();
            }
            else if (this.config.withdraw.cex === "bitget") {
                const withdrawal = new BitgetWithdraw(this.accountIndex, this.privateKey, this.config);
                return await withdrawal.withdraw();
            }
            return false;
        }
        catch (error) {
            logger.error(`${this.address} | Error withdraw: ${error}`);
            return false;
        }
    }
    async collectAllData() {
        return await this.retryOperation(async () => {
            try {
                const userInfo = await this._getUserInfo();
                const balances = await this._getAbsWalletBalances();
                const badges = userInfo.user.badges;
                const totalPoints = userInfo.user.totalExperiencePoints;
                let discordConnected = false;
                let twitterConnected = false;
                let totalBadges = 0;
                for (const badge of badges) {
                    if (badge.claimed) {
                        totalBadges++;
                    }
                }
                const socials = userInfo.user.socials;
                for (const [social, username] of Object.entries(socials)) {
                    if (social === "discord") {
                        logger.success(`${this.accountIndex} | ${this.address} | Discord ${username} already connected!`);
                        discordConnected = true;
                    }
                    else if (social === "twitter") {
                        logger.success(`${this.accountIndex} | ${this.address} | Twitter ${username} already connected!`);
                        twitterConnected = true;
                    }
                }
                let totalUsdBalance = 0;
                if (balances) {
                    for (const balance of balances) {
                        try {
                            totalUsdBalance += balance.usdValue;
                        }
                        catch (error) { }
                    }
                }
                const progressData = {
                    EvmPrivateKey: this.privateKey,
                    PrivyPrivateKey: this.privyPrivateKey,
                    EvmAddress: this.address,
                    PrivyAddress: this.embeddedWalletAddress,
                    Points: totalPoints,
                    AbsUsdBalance: totalUsdBalance.toFixed(2),
                    BadgesClaimed: totalBadges,
                    IsTwitterConnected: twitterConnected,
                    IsDiscordConnected: discordConnected,
                };
                await saveProgress(this.config.mutex, progressData);
                return true;
            }
            catch (error) {
                logger.error(`${this.address} | Error collect all data: ${error}`);
                return false;
            }
        }, "Collect all data");
    }
    async _bridge() {
        try {
            // Check Arbitrum ETH balance
            const randomRpc = getRandomRpc(this.config.rpcs.arbitrum_rpc);
            const arbitrumProvider = new ethers.JsonRpcProvider(randomRpc);
            const arbitrumBalance = await arbitrumProvider.getBalance(this.address);
            const minRequired = ethers.parseEther(this.config.bridge.eth_to_bridge[0].toString());
            // If balance is too low, check if withdrawals are enabled
            if (arbitrumBalance < minRequired) {
                logger.info(`${this.accountIndex} | ${this.address} | Arbitrum balance is too low ${ethers.formatEther(arbitrumBalance)} ETH`);
                if (!this.config.withdraw.withdraw_enabled) {
                    logger.info(`${this.accountIndex} | ${this.address} | Withdrawals are disabled in config, skipping...`);
                    return false;
                }
                logger.info(`${this.accountIndex} | ${this.address} | Withdrawing...`);
                const withdrawResult = await this.withdraw();
                if (!withdrawResult) {
                    return false;
                }
                const pauseTime = randomInt(this.config.settings.pause_after_withdrawal[0], this.config.settings.pause_after_withdrawal[1]);
                logger.info(`${this.accountIndex} | ${this.wallet.address} | Waiting ${pauseTime.toString()} seconds after withdrawal`);
                await sleep(pauseTime * 1000);
                // Check balance again
                const newBalance = await arbitrumProvider.getBalance(this.address);
                if (newBalance < minRequired) {
                    logger.error(`${this.accountIndex} | ${this.address} | Balance still too low after withdrawal: ${ethers.formatEther(newBalance)} ETH`);
                    return false;
                }
                // Proceed with bridge using new balance
                logger.success(`${this.accountIndex} | ${this.address} | New Arbitrum balance after withdrawal: ${ethers.formatEther(newBalance)} ETH, proceeding with bridge`);
                // Calculate safe amount to bridge (95% of balance or max from config, whichever is lower)
                const maxFromConfig = ethers.parseEther(this.config.bridge.eth_to_bridge[1].toString());
                const safeBalance = (newBalance * BigInt(95)) / BigInt(100);
                const maxToUse = safeBalance < maxFromConfig ? safeBalance : maxFromConfig;
                // Calculate random amount between min and max
                const minEth = ethers.parseEther(this.config.bridge.eth_to_bridge[0].toString());
                const randomAmount = minEth +
                    BigInt(Math.floor(Math.random() * Number(maxToUse - minEth)));
                logger.info(`${this.accountIndex} | ${this.address} | Will bridge ${ethers.formatEther(randomAmount)} ETH`);
                return await this._executeBridge(randomAmount);
            }
            else {
                logger.success(`${this.accountIndex} | ${this.address} | Arbitrum balance is ${ethers.formatEther(arbitrumBalance)} ETH, proceeding with bridge`);
                // Calculate safe amount to bridge (95% of balance or max from config, whichever is lower)
                const maxFromConfig = ethers.parseEther(this.config.bridge.eth_to_bridge[1].toString());
                const safeBalance = (arbitrumBalance * BigInt(95)) / BigInt(100);
                const maxToUse = safeBalance < maxFromConfig ? safeBalance : maxFromConfig;
                // Calculate random amount between min and max
                const minEth = ethers.parseEther(this.config.bridge.eth_to_bridge[0].toString());
                const randomAmount = minEth +
                    BigInt(Math.floor(Math.random() * Number(maxToUse - minEth)));
                logger.info(`${this.accountIndex} | ${this.address} | Will bridge ${ethers.formatEther(randomAmount)} ETH`);
                return await this._executeBridge(randomAmount);
            }
        }
        catch (error) {
            logger.error(`${this.address} | Error bridge: ${error}`);
            return false;
        }
    }
    // Helper method to execute the bridge
    async _executeBridge(amount) {
        const bridge = new RelayBridge(this.accountIndex, this.proxy, this.privateKey, this.config, this.embeddedWalletAddress);
        let quoteResult = await bridge.quote(amount.toString());
        if (!quoteResult) {
            return false;
        }
        let bridgeResult = await bridge.bridge();
        if (!bridgeResult) {
            return false;
        }
        logger.success(`${this.accountIndex} | ${this.address} | Successfully bridged ETH from Arbitrum to Abstract`);
        logger.info(`${this.accountIndex} | ${this.address} | Waiting 30 seconds after bridge...`);
        await sleep(30000);
        return true;
    }
    /**
     * Get user's votes
     */
    async _getMyVotes() {
        try {
            const headers = {
                accept: "application/json, text/plain, */*",
                authorization: `Bearer ${this.loginTokens.bearer_token}`,
                origin: "https://www.abs.xyz",
                referer: "https://www.abs.xyz/",
                "x-privy-token": this.loginTokens.identity_token,
            };
            const response = await this.httpClient.get(`https://backend.portal.abs.xyz/api/user/${this.embeddedWalletAddress}/votes`, { headers });
            if (!response.ok) {
                throw new Error(`Failed to get user votes: ${await response.text()}`);
            }
            const data = await response.json();
            return data.votedApps;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error get my votes: ${error}`);
            return null;
        }
    }
    /**
     * Get nonce for signing
     */
    async _getNonce() {
        try {
            const headers = {
                accept: "application/json",
                origin: "https://www.abs.xyz",
                "privy-app-id": PRIVY_APP_ID,
                "privy-client-id": PRIVY_CLIENT_ID,
                referer: "https://www.abs.xyz/",
            };
            const jsonData = {
                address: this.address,
            };
            const response = await this.httpClient.post("https://auth.privy.io/api/v1/siwe/init", { headers, json: jsonData });
            if (!response.ok) {
                throw new Error(`Failed to get nonce: ${await response.text()}`);
            }
            const { nonce } = await response.json();
            return nonce;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error get nonce: ${error}`);
            throw error;
        }
    }
    /**
     * Refresh session
     */
    async _refreshSession() {
        try {
            const headers = {
                accept: "application/json",
                authorization: `Bearer ${this.loginTokens.privy_access_token}`,
                origin: "https://www.abs.xyz",
                "privy-app-id": PRIVY_APP_ID,
                "privy-client-id": PRIVY_CLIENT_ID,
                referer: "https://www.abs.xyz/",
            };
            const jsonData = {
                refresh_token: this.loginTokens.refresh_token,
            };
            const response = await this.httpClient.post("https://auth.privy.io/api/v1/sessions", { headers, json: jsonData });
            const data = await response.json();
            this.loginTokens.identity_token = data.identity_token;
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error refresh session: ${error}`);
            return false;
        }
    }
    // Create embedded wallet
    async _createEmbeddedWallet() {
        try {
            const headers = {
                accept: "application/json",
                authorization: `Bearer ${this.loginTokens.privy_access_token}`,
                origin: "https://auth.privy.io",
                "privy-app-id": PRIVY_APP_ID,
                "privy-client-id": PRIVY_CLIENT_ID,
                referer: "https://auth.privy.io/",
            };
            const jsonData = {
                address: this.address,
                chain_type: "ethereum",
            };
            const response = await this.httpClient.post("https://auth.privy.io/api/v1/embedded_wallets/init", { headers, json: jsonData });
            if (!response.ok) {
                throw new Error(`Failed to get embedded wallets: ${await response.text()}`);
            }
            if (!(await this._refreshSession())) {
                return false;
            }
            logger.success(`${this.accountIndex} | ${this.address} | Successfully created embedded wallet!`);
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error creating embedded wallet: ${error}`);
            return false;
        }
    }
    /**
     * Generate random device data
     */
    _generateRandomDeviceData() {
        const generateBase64 = (length) => {
            const randomBytes = crypto.randomBytes(length);
            return randomBytes.toString("base64").slice(0, length);
        };
        const generateAlphanumeric = (length) => {
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            return Array.from(crypto.randomBytes(length), (byte) => chars[byte % chars.length]).join("");
        };
        return {
            device_id: generateAlphanumeric(20),
            device_auth_share: generateBase64(20) + "=",
            recovery_auth_share: generateBase64(20) + "=",
            encrypted_recovery_share: generateBase64(40),
            encrypted_recovery_share_iv: generateBase64(12) + "/",
            recovery_type: "privy_generated_recovery_key",
            recovery_key_hash: generateBase64(40) + "=",
            imported: false,
            recovery_key: generateBase64(40) + "=",
        };
    }
    /**
     * Get ABS wallet balances
     */
    async _getAbsWalletBalances() {
        try {
            const headers = {
                accept: "application/json, text/plain, */*",
                authorization: `Bearer ${this.loginTokens.bearer_token}`,
                origin: "https://www.abs.xyz",
                referer: "https://www.abs.xyz/",
                "x-privy-token": this.loginTokens.identity_token,
            };
            const response = await this.httpClient.get(`https://backend.portal.abs.xyz/api/user/${this.embeddedWalletAddress}/wallet/balances`, { headers });
            if (!response.ok) {
                throw new Error(`Failed to get abs wallet balances: ${await response.text()}`);
            }
            const data = await response.json();
            const allBalances = data.tokens.map((token) => ({
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                rawBalance: token.balance.raw,
                decimalBalance: token.balance.decimal,
                usdValue: token.usdValue,
            }));
            return allBalances;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error get abs wallet balances: ${error}`);
            return null;
        }
    }
    /**
     * Connect Discord account
     */
    async _connectDiscord() {
        for (let retry = 0; retry < this.config.settings.tasks_attempts; retry++) {
            try {
                const headers = {
                    accept: "application/json, text/plain, */*",
                    authorization: `Bearer ${this.loginTokens.bearer_token}`,
                    origin: "https://www.abs.xyz",
                    referer: "https://www.abs.xyz/",
                    "x-privy-token": this.loginTokens.identity_token,
                };
                const jsonData = {
                    isInitialFlow: false,
                };
                const response = await this.httpClient.post("https://backend.portal.abs.xyz/api/social/discord", { headers, json: jsonData });
                if (!response.ok) {
                    throw new Error(`Failed to init discord connect: ${await response.text()}`);
                }
                const { authUrl } = await response.json();
                const url = new URL(authUrl);
                const state = decodeURIComponent(url.searchParams.get("state") || "");
                const clientId = url.searchParams.get("client_id");
                if (!clientId) {
                    throw new Error("Failed to get client_id from auth URL");
                }
                const discordHeaders = {
                    accept: "*/*",
                    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,ru;q=0.7,zh-TW;q=0.6,zh;q=0.5",
                    authorization: this.discordToken,
                    origin: "https://discord.com",
                    referer: `https://discord.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=https%3A%2F%2Fbackend.portal.abs.xyz%2Fapi%2Fsocial%2Fdiscord%2Fcallback&state=${state}`,
                    "x-debug-options": "bugReporterEnabled",
                    "x-discord-locale": "en-US",
                    "x-discord-timezone": "Etc/GMT-2",
                };
                const discordJsonData = {
                    authorize: true,
                    integration_type: 0,
                    location_context: {
                        channel_id: "10000",
                        channel_type: 10000,
                        guild_id: "10000",
                    },
                    permissions: "0",
                };
                const params = {
                    client_id: clientId,
                    response_type: "code",
                    redirect_uri: "https://backend.portal.abs.xyz/api/social/discord/callback",
                    scope: "identify guilds guilds.members.read",
                    state: state,
                };
                const discordResponse = await this.httpClient.post(`https://discord.com/api/v9/oauth2/authorize?${new URLSearchParams(params)}`, {
                    headers: discordHeaders,
                    json: discordJsonData,
                });
                if (!discordResponse.ok) {
                    const responseData = await discordResponse.text();
                    if (responseData.includes("Unauthorized")) {
                        throw new Error(`Discord token is invalid.`);
                    }
                    throw new Error(`Failed to authorize discord: ${await discordResponse.text()}`);
                }
                const { location } = await discordResponse.json();
                const finalResponse = await this.httpClient.get(location);
                if (!finalResponse.ok) {
                    throw new Error(`Failed to connect discord: ${await finalResponse.text()}`);
                }
                logger.success(`${this.accountIndex} | ${this.address} | Successfully connected discord!`);
                return true;
            }
            catch (error) {
                logger.error(`${this.accountIndex} | ${this.address} | RETRY ${retry + 1}/${this.config.settings.tasks_attempts} | Error connect discord: ${error}`);
                const randomPause = Math.floor(Math.random() *
                    (this.config.settings.pause_between_attempts[1] -
                        this.config.settings.pause_between_attempts[0]) +
                    this.config.settings.pause_between_attempts[0]);
                logger.info(`${this.accountIndex} | ${this.address} | Pausing for ${randomPause} seconds...`);
                await new Promise((resolve) => setTimeout(resolve, randomPause * 1000));
            }
        }
        return false;
    }
    /**
     * Connect Twitter account
     */
    async _connectTwitter() {
        try {
            let headers = {
                accept: "application/json, text/plain, */*",
                authorization: `Bearer ${this.loginTokens.bearer_token}`,
                origin: "https://www.abs.xyz",
                referer: "https://www.abs.xyz/",
                "x-privy-token": this.loginTokens.identity_token,
            };
            let response = await this.httpClient.post(`https://backend.portal.abs.xyz/api/social/twitter`, { json: { isInitialFlow: false }, headers: headers });
            if (!response.ok) {
                throw new Error(`Failed to get twitter connection link: ${await response.text()}`);
            }
            let responseData = await response.json();
            const twitterAuthUrl = responseData["authUrl"];
            // Parse the Twitter auth URL
            const parsedUrl = new URL(twitterAuthUrl);
            const params = {
                responseType: parsedUrl.searchParams.get("response_type"),
                clientId: parsedUrl.searchParams.get("client_id"),
                redirectUri: parsedUrl.searchParams.get("redirect_uri"),
                scope: parsedUrl.searchParams.get("scope"),
                state: parsedUrl.searchParams.get("state"),
                codeChallenge: parsedUrl.searchParams.get("code_challenge"),
                codeChallengeMethod: parsedUrl.searchParams.get("code_challenge_method"),
            };
            // Construct the Twitter API OAuth URL with our parsed params
            const twitterApiUrl = `https://twitter.com/i/api/2/oauth2/authorize?client_id=${encodeURIComponent(params.clientId)}&code_challenge=${encodeURIComponent(params.codeChallenge)}&code_challenge_method=${encodeURIComponent(params.codeChallengeMethod)}&redirect_uri=${encodeURIComponent(params.redirectUri)}&response_type=${encodeURIComponent(params.responseType)}&scope=${encodeURIComponent(params.scope)}&state=${encodeURIComponent(params.state)}`;
            let csrfToken = generateCsrfToken();
            let twitterHeaders = {
                authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                accept: "*/*",
                "accept-language": "ru-RU,ru;q=0.8",
                cookie: `lang=en; auth_token=${this.twitterToken}; ct0=${csrfToken};`,
                "content-type": "application/x-www-form-urlencoded",
                "referrer-policy": "strict-origin-when-cross-origin",
                "x-twitter-active-user": "yes",
                "x-twitter-auth-type": "OAuth2Session",
                "x-twitter-client-language": "en",
                "x-csrf-token": csrfToken,
            };
            // Make request to Twitter API OAuth endpoint
            const twitterResponse = await this.httpClient.get(twitterApiUrl, {
                headers: twitterHeaders,
            });
            if (!twitterResponse.ok) {
                throw new Error(`Failed to authorize with Twitter: ${await twitterResponse.text()}`);
            }
            responseData = await twitterResponse.json();
            const authCode = responseData["auth_code"];
            logger.success(`${this.accountIndex} | ${this.address} | Got twitter auth code: ${authCode}`);
            responseData = await this.httpClient.post(`https://twitter.com/i/api/2/oauth2/authorize`, {
                json: {
                    approval: true,
                    code: authCode,
                },
                headers: twitterHeaders,
            });
            if (!responseData.ok) {
                if (await responseData
                    .text()
                    .includes("Please try again in a few minutes")) {
                    logger.error(`${this.accountIndex} | ${this.address} | Twitter is rate limited. Please try again later.`);
                    return false;
                }
                throw new Error(`Failed to connect twitter: ${await responseData.text()}`);
            }
            const redirectUrlData = await responseData.json();
            const redirectUrl = redirectUrlData["redirect_uri"];
            responseData = await this.httpClient.get(redirectUrl, {
                headers: twitterHeaders,
            });
            if (!responseData.ok) {
                throw new Error(`Failed to connect twitter: ${await responseData.text()}`);
            }
            const url = await responseData.url;
            if (url.includes("www.abs.xyz/rewards?twitterHandle=")) {
                const username = url.split("www.abs.xyz/rewards?twitterHandle=")[1];
                logger.success(`${this.accountIndex} | ${this.address} | Successfully connected twitter ${username}.`);
                return true;
            }
            else if (url.includes("error=duplicate")) {
                logger.error(`${this.accountIndex} | ${this.address} | This twitter token is already connected to another account.`);
                return false;
            }
            return false;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error connect twitter: ${error}`);
            return false;
        }
    }
    /**
     * Get user info
     */
    async _getUserInfo() {
        try {
            const headers = {
                accept: "application/json, text/plain, */*",
                authorization: `Bearer ${this.loginTokens.bearer_token}`,
                origin: "https://www.abs.xyz",
                referer: "https://www.abs.xyz/",
                "x-privy-token": this.loginTokens.identity_token,
            };
            const response = await this.httpClient.post("https://backend.portal.abs.xyz/api/user", { headers, json: {} });
            if (!response.ok) {
                throw new Error(`Failed to get user info: ${await response.text()}`);
            }
            return await response.json();
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error get user info: ${error}`);
            throw error;
        }
    }
}

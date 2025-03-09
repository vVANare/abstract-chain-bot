import { ethers } from "ethers";
import { getRandomRpc } from "../../utils/random.js";
import logger from "../../utils/logger.js";
import { MYRIAD_CHAIN_ID, MYRIAD_CLIENT_ID } from "./constants.js";
class Myriad {
    accountIndex;
    proxy;
    privateKey;
    privyPrivateKey;
    abstractAccount;
    embeddedWalletAddress;
    twitterToken;
    discordToken;
    config;
    httpClient;
    wallet;
    provider;
    address;
    loginTokens = {
        bearer_token: "",
        privy_access_token: "",
        refresh_token: "",
        identity_token: "",
        userLogin: "",
    };
    constructor(accountIndex, proxy, privateKey, privyPrivateKey, abstractAccount, embeddedWalletAddress, twitterToken, discordToken, config, httpClient) {
        this.accountIndex = accountIndex;
        this.proxy = proxy;
        this.privateKey = privateKey;
        this.privyPrivateKey = privyPrivateKey;
        this.abstractAccount = abstractAccount;
        this.embeddedWalletAddress = embeddedWalletAddress;
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
    async init() {
        try {
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error init: ${error}`);
            return false;
        }
    }
    async login() {
        try {
            const queryParams = new URLSearchParams({
                clientId: MYRIAD_CLIENT_ID,
                address: this.embeddedWalletAddress,
                chainId: MYRIAD_CHAIN_ID,
            }).toString();
            console.log(queryParams);
            let response = await this.httpClient.get(`https://embedded-wallet.thirdweb.com/api/2024-05-05/login/siwe?${queryParams}`, {
                headers: {
                    accept: "*/*",
                    origin: "https://myriad.markets",
                    referer: "https://myriad.markets/",
                    "x-client-id": MYRIAD_CLIENT_ID,
                    "x-sdk-name": "unified-sdk",
                    "x-sdk-os": "win",
                    "x-sdk-platform": "browser",
                    "x-sdk-version": "5.88.3",
                },
            });
            const dataJson = await response.json();
            console.log(dataJson);
            const nonce = dataJson.nonce;
            const issuedAt = dataJson.issued_at;
            const expirationTime = dataJson.expiration_time;
            const notBefore = dataJson.invalid_before;
            const message = `https://myriad.markets wants you to sign in with your Ethereum account:
            ${this.address}
            
            Please ensure that the domain above matches the URL of the current website.
            
            URI: https://myriad.markets
            Version: 1
            Chain ID: 2741
            Nonce: ${nonce}
            Issued At: ${issuedAt}
            Expiration Time: ${expirationTime}
            Not Before: ${notBefore}
            `;
            const signature = await this.wallet.signMessage(message);
            const queryParamsLogin = new URLSearchParams({
                clientId: MYRIAD_CLIENT_ID,
                signature: signature,
                payload: "[object Object]",
            }).toString();
            response = await this.httpClient.post(`https://embedded-wallet.thirdweb.com/api/2024-05-05/login/siwe/callback?${queryParamsLogin}`, {
                json: {
                    signature: "0x" + signature,
                    payload: {
                        domain: "https://myriad.markets",
                        address: this.embeddedWalletAddress,
                        statement: "Please ensure that the domain above matches the URL of the current website.",
                        uri: "https://myriad.markets",
                        version: "1",
                        chain_id: "2741",
                        nonce: nonce,
                        issued_at: issuedAt,
                        expiration_time: expirationTime,
                        invalid_before: notBefore,
                    },
                },
                headers: {
                    accept: "*/*",
                    "content-type": "application/json",
                    origin: "https://myriad.markets",
                    referer: "https://myriad.markets/",
                    "x-client-id": MYRIAD_CLIENT_ID,
                    "x-sdk-name": "unified-sdk",
                    "x-sdk-os": "win",
                    "x-sdk-platform": "browser",
                    "x-sdk-version": "5.88.3",
                },
            });
            const dataJsonLogin = await response.json();
            console.log(dataJsonLogin);
            return true;
        }
        catch (error) {
            logger.error(`${this.accountIndex} | ${this.address} | Error login: ${error}`);
            return false;
        }
    }
}
export default Myriad;

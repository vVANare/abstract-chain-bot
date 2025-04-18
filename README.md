# abstract-chain-bot
Bot for abstract chain automation.

## ⚙️ Installation
1. **Download the bot**
```sh
git clone https://github.com/vVANare/abstract-chain-bot
```

2. **Open folder**
```sh
cd abstract-chain-bot
```

3. **Install all required dependencies**
```sh
npm install
```

4. **Install Playwright**
```sh
npx playwright install
```

5. **Run the bot**
```sh
npm start
```

## 📁 Data folder
You will need a private key, a proxy, Twitter token and discord token for the bot to work.

All this data must be inserted into the /data  folder line by line in the corresponding txt files.

❗The bot supports only http proxies in the following format - user:pass@ip:port.

## 📝 Data/config.yaml
The main settings are in the data/config.yaml file in the main project folder.

Most of the settings are self-explanatory and have descriptions, I will only go over the ones that may cause difficulties.

Tasks
The selection of functions to work with goes through the tasks field in the config. This variable contains the route to work on. Each function is signed in the comments above this field. For example, if you only want to use swaps and nothing else, then you write tasks: [“swaps”]. If you want to make votes and swaps tasks then tasks: [“votes”, “swaps”]. You can combine tasks in any order.

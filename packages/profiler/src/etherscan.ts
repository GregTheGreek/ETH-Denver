import { decodeHTML } from 'entities';
import * as fs from 'fs-extra';
import 'isomorphic-fetch';
import { default as JSSoup } from 'jssoup';
import * as queryString from 'query-string';
import * as Web3 from 'web3';

import { ETHERSCAN_API_KEY } from './secrets';
import { ContractInfo, Transaction } from './types';
import { readHex } from './utils';
import { web3Wrapper } from './web3';

export const etherscan = {
    async smartlyGetTransactionsForAccountAsync(address: string, limit: number): Promise<Transaction[]> {
        const blockNumber = (await web3Wrapper.getBlockNumberAsync()) - 10;
        let blockWindowSize = 1;
        while (true) {
            console.log(`Block window size: ${blockWindowSize}`);
            const transactions = await etherscan.getTransactionsForAccountAsync(
                address,
                blockNumber - blockWindowSize + 1,
                blockNumber,
            );
            console.log(`Transactions: ${transactions.length}`);
            if (transactions.length >= limit) {
                return transactions.slice(0, limit);
            } else {
                blockWindowSize *= 4;
            }
        }
    },
    async getTransactionsForAccountAsync(
        address: string,
        startblock: number,
        endblock: number,
    ): Promise<Transaction[]> {
        const params = {
            module: 'account',
            action: 'txlist',
            address,
            startblock,
            endblock,
            apikey: ETHERSCAN_API_KEY,
        };
        const url = `http://api.etherscan.io/api?${queryString.stringify(params)}`;
        const result = await fetch(url);
        const jsonResponse = await result.json();
        const txs = jsonResponse.result;
        return txs;
    },
    async getContractABIAsync(address: string): Promise<Web3.ContractAbi> {
        const params = {
            module: 'contract',
            action: 'getabi',
            address,
            apikey: ETHERSCAN_API_KEY,
        };
        const url = `http://api.etherscan.io/api?${queryString.stringify(params)}`;
        const result = await fetch(url);
        const jsonResponse = await result.json();
        const abi = JSON.parse(jsonResponse.result);
        return abi;
    },
    async getContractInfoAsync(address: string): Promise<ContractInfo> {
        const cachePath = `./contract_metadata_cache/${address}.json`;
        const cached = await fs.pathExists(cachePath);
        if (cached) {
            const contractMetadata = await fs.readJSON(cachePath);
            return contractMetadata;
        } else {
            const url = `https://etherscan.io/address/${address}`;
            console.log(`FETCH ${url}`);
            const response = await fetch(url);
            const body = await response.text();
            const soup = new JSSoup(body);
            const sourcecode = decodeHTML(
                soup
                    .find('div', { id: 'dividcode' })
                    .find('pre')
                    .contents.toString(),
            );
            const bytecodeHex = soup.find('div', { id: 'verifiedbytecode2' }).contents[0].toString();
            const bytecode = readHex(bytecodeHex);
            const readTable = row =>
                soup
                    .find('div', { id: 'ContentPlaceHolder1_contractCodeDiv' })
                    .findAll('td')
                    [row * 2 + 1].contents[0].toString()
                    .trim();
            const name = readTable(0);
            const solcVersion = readTable(1);
            const optimized = readTable(2) !== 'No';
            const optimizedRounds = parseInt(readTable(3), 10);
            const contractMetadata = {
                name,
                solcVersion,
                optimized,
                optimizedRounds,
                sourcecode,
                bytecode,
            };
            await fs.writeJSON(cachePath, contractMetadata);
            return contractMetadata;
        }
    },
};
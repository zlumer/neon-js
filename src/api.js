import axios from 'axios';
import { getAccountsFromWIFKey, transferTransaction, signatureData, addContract, claimTransaction } from './wallet.js';

const apiEndpoint = "http://testnet.antchain.xyz";
const rpcEndpoint = "http://api.otcgo.cn:20332"; // testnet = 20332

const ANS = '\u5c0f\u8681\u80a1';
const ANC = '\u5c0f\u8681\u5e01';

// hard-code asset ids for ANS and ANC
export const ansId = "c56f33fc6ecfcd0c225c4ab356fee59390af8560be0e930faebe74a6daff7c9b";
export const ancId = "602c79718b16e442de58778e148d0b1084e3b2dffd5de6b7b16cee7969282de7";
export const allAssetIds = [ansId, ancId];

export const MAINNET = "MainNet";
export const TESTNET = "TestNet";

// hard-code asset names for ANS and ANC
const ansName = "小蚁股";
const ancName = "小蚁币";

const getAns = balance => balance.filter((val) => { return val.unit === ANS })[0];
const getAnc = balance => balance.filter((val) => { return val.unit === ANC })[0];

// API methods (using neon wallet API)

// get neon wallet API endpoint for MainNet or TestNet
export const getAPIEndpoint = (net) => {
  if (net === "MainNet"){
    return "http://neo.herokuapp.com";
  } else {
    return "http://neo-testnet.herokuapp.com"; //, //"http://testnet.antchain.xyz",
  }
};

// get node RPC endpoint on MainNet or TestNet based on block height status from neon wallet API
export const getRPCEndpoint = (net) => {
  const apiEndpoint = getAPIEndpoint(net);
  return axios.get(apiEndpoint + '/v2/network/best_node').then((response) => {
      return response.data.node;
  });
};

// get all available claim on an account using neon wallet API
export const getAvailableClaim = (net, address) => {
  const apiEndpoint = getAPIEndpoint(net);
  return axios.get(apiEndpoint + '/v2/address/claims/' + address).then((res) => {
    return parseInt(res.data.total_claim);
  });
}


// get the balance at an address using the neon wallet API
export const getBalance = (net, address) => {
    const apiEndpoint = getAPIEndpoint(net);
    return axios.get(apiEndpoint + '/v2/address/balance/' + address)
      .then((res) => {
          const ans = res.data.NEO.balance;
          const anc = res.data.GAS.balance;
          return {ANS: ans, ANC: anc, unspent: {ANS: res.data.NEO.unspent, ANC: res.data.GAS.unspent}};
      })
};

/**
 * @function
 * @description
 * Hit the bittrex api getticker to fetch the latest BTC to ANS price
 * then hit the latest USDT to BTC conversion rate
 *
 * @param {number} amount - The current ANS amount in wallet
 * @return {string} - The converted ANS to USDT fiat amount
 */
export const getMarketPriceUSD = (amount) => {
  let lastBTCANS, lastUSDBTC;
  return axios.get('https://bittrex.com/api/v1.1/public/getticker?market=BTC-ANS').then((response) => {
      lastBTCANS = response.data.result.Last;
      return axios.get('https://bittrex.com/api/v1.1/public/getticker?market=USDT-BTC').then((response) => {
          lastUSDBTC = response.data.result.Last;
          return ('$' + (lastBTCANS * lastUSDBTC * amount).toFixed(2).toString());
      });
  });
};

// get history of balance over time using neon wallet API
export const getTransactionHistory = (net, address) => {
  const apiEndpoint = getAPIEndpoint(net);
  return axios.get(apiEndpoint + '/v2/address/history/' + address).then((response) => {
    return response.data.history;
  });
};

// get block height reported by neon wallet API
export const getWalletDBHeight = (net) => {
  const apiEndpoint = getAPIEndpoint(net);
  return axios.get(apiEndpoint + '/v2/block/height').then((response) => {
    return parseInt(response.data.block_height);
  });
}

// RPC methods

// wrapper for querying node RPC on MainNet or TestNet
const queryRPC = (net, method, params, id = 1) => {
  let jsonRequest = axios.create({
    headers: {"Content-Type": "application/json"}
  });
  const jsonRpcData = {"jsonrpc": "2.0", "method": method, "params": params, "id": id};
  return getRPCEndpoint(net).then((rpcEndpoint) => {
    return jsonRequest.post(rpcEndpoint, jsonRpcData).then((response) => {
      return response.data;
    });
  });
};

// get a block from the RPC
export const getBlockByIndex = (net, block) => {
  return queryRPC(net, "getblock", [block, 1]);
}

// get block height from the RPC
export const getBlockCount = (net, block) => {
  return queryRPC(net, "getblockcount", []);
}

// submit a claim request for all available GAS at an address
export const claimAllGAS = (net, fromWif) => {
  const apiEndpoint = getAPIEndpoint(net);
  const account = getAccountsFromWIFKey(fromWif)[0];
  // TODO: when fully working replace this with mainnet/testnet switch
  return axios.get(apiEndpoint + "/v2/address/claims/" + account.address).then((response) => {
    console.log(response.data['claims']);
    const claims = response.data["claims"];
    const total_claim = response.data["total_claim"];
    const txData = claimTransaction(claims, account.publickeyEncoded, account.address, total_claim);
    const sign = signatureData(txData, account.privatekey);
    const txRawData = addContract(txData, sign, account.publickeyEncoded);
    return queryRPC(net, "sendrawtransaction", [txRawData], 2);
  });
}

// send an asset (NEO or GAS) over the node RPC
export const sendAssetTransaction = (net, toAddress, fromWif, assetType, amount) => {
  let assetId, assetName, assetSymbol;
  if (assetType === "AntShares"){
    assetId = ansId;
    assetName = ansName;
    assetSymbol = 'ANS';
  } else if (assetType === "AntCoins") {
    assetId = ancId;
    assetName = ancName;
    assetSymbol = 'ANC';
  }
  const fromAccount = getAccountsFromWIFKey(fromWif)[0];
  return getBalance(net, fromAccount.address).then((response) => {
    const coinsData = {
      "assetid": assetId,
      "list": response.unspent[assetSymbol],
      "balance": response[assetSymbol],
      "name": assetName
    }
    const txData = transferTransaction(coinsData, fromAccount.publickeyEncoded, toAddress, amount);
    const sign = signatureData(txData, fromAccount.privatekey);
    const txRawData = addContract(txData, sign, fromAccount.publickeyEncoded);
    return queryRPC(net, "sendrawtransaction", [txRawData], 4);
  });
};

const axios = require("axios");
const bitcoin = require("bitcoinjs-lib");
require("dotenv").config();

// Function to check balance using blockstream
async function checkBalance(address) {
  try {
    const response = await axios.get(
      `${process.env.API_BLOCKSTREAM_MAIN_SERVER}/address/${address}/utxo`
    );
    const utxos = response.data;
    let totalBalance = 0;
    for (const utxo of utxos) {
      totalBalance += utxo.value;
    }
    const balance = totalBalance / 100000000;

    return balance;
  } catch (error) {
    console.error("Failed to check balance:", error);
    throw error;
  }
}

// Function to check balance using blockcypher
async function checkBalance1(address) {
  const btc_balance_resp = await axios.get(
    `https://blockchain.info/q/addressbalance/${address}`
  );
  // got with satoshi
  const btc_balance = parseInt(btc_balance_resp.data, 10);
  return btc_balance;
}

// Function to make a withdrawal
async function withdrawal(fromAddress, toAddress, amt) {
  try {
    // Get BTC Transactions
    const apiUrl = `${API_BLOCKCYPHER_SERVER}/addrs/${fromAddress}/full?token=${BLOCKCYPHER_TOKEN}`;
    const response = await axios.get(apiUrl, { params: { limit: 50 } });
    const transactions = response.data.txs;

    // Check if BTC TRXs are exist or not
    if (transactions?.length > 0) {
      // Get Raw Transaction with Trx Hash
      const txHash = transactions[0].hash;
      let { data: rawTransaction } = await axios.get(
        `${API_BLOCKCYPHER_SERVER}/txs/${txHash}?token=${BLOCKCYPHER_TOKEN}`,
        { params: { includeHex: true, limit: 1000 } }
      );

      // New BTC Trx Object
      const psbt1 = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

      // Find Output Index
      function findOutputIndex(transaction, userAddress) {
        for (let i = 0; i < transaction.outputs.length; i++) {
          const output = transaction.outputs[i];
          if (output.addresses.includes(userAddress)) {
            return i;
          }
        }
        return -1;
      }

      const outputIndex = findOutputIndex(transactions[0], fromAddress);

      const inputData = {
        hash: txHash,
        index: outputIndex,
        nonWitnessUtxo: Buffer.from(rawTransaction.hex, "hex"),
      };

      // Get BTC balance with satoshi
      const btc_balance = await checkBalance1(fromAddress);

      // BTC Trx Input
      psbt1.addInput(inputData);

      // BTC Trx Output (two Outputs)
      psbt1.addOutput({
        address: toAddress, // Receptionist Address
        value: Number(amt) * 10 ** 8,
      });

      psbt1.addOutput({
        address: fromAddress, // Sender Address; Change will be returned to signer
        value: btc_balance - Number(amt) * 10 ** 8,
      });

      const fKeyPair = ECPair.fromWIF(
        process.env.MAIN_PRI_KEY,
        bitcoin.networks.bitcoin
      );

      // BTC Trx Sign Input
      psbt1.signInput(0, fKeyPair);
      psbt1.finalizeAllInputs();

      // Get Fee Rate
      const feeResponse = await axios.post(`${BTC_GETBLOCK_SERVER}`, {
        jsonrpc: "2.0",
        method: "estimatesmartfee",
        params: [1, "conservative"],
        id: "getblock.io",
      });
      const feeRate = (feeResponse?.data?.result?.feerate / 1024) * 100000000;
      const vSize = psbt1.extractTransaction().virtualSize();
      const fee = (feeRate * vSize) / 10 ** 8;

      const realAmt = Number(amt) + fee; // ? )) so in total btc_balance - fee - amt

      // we must consider dustLimit, the dustLimit is dustLimit: 600(satoshi not btc),
      // it's not defined in this code ))
      if (realAmt * 10 ** 8 <= 600) {
        const msg = "You should send the exact amount more than 600 satoshi.";
        throw msg;
      }

      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

      psbt.addInput(inputData);

      // BTC Trx Output (two Outputs)
      psbt.addOutput({
        address: toAddress, // Receptionist Address
        value: Number((Number(amt) * 10 ** 8).toFixed(0)),
      });

      psbt.addOutput({
        address: fromAddress, // Sender Address; Change will be returned to signer
        value: btc_balance - Number((Number(realAmt) * 10 ** 8).toFixed(0)),
      });

      psbt.signInput(0, fKeyPair);
      psbt.finalizeAllInputs();

      // here boradcast it to BlockCypher done! https://www.blockcypher.com/
      const txHex = psbt.extractTransaction().toHex();
      let { data: pushed } = await axios.post(
        `${API_BLOCKCYPHER_SERVER}/txs/push?token=${BLOCKCYPHER_TOKEN}`,
        { tx: txHex }
      );

      console.log(pushed);

      return pushed;
    } else {
      const msg = "Internal Server Error";
      throw msg;
    }
  } catch (error) {
    console.error("Failed to make withdrawal:", error);
    throw error;
  }
}

// Function to check transaction
async function checkTransaction(txid) {
  try {
    const response = await axios.get(
      `${process.env.API_BLOCKSTREAM_MAIN_SERVER}/tx/${txid}`
    );

    return response.data;
  } catch (error) {
    console.error("Failed to check transaction:", error);
    throw error;
  }
}

(async () => {
  try {
    const balance = await checkBalance(process.env.MAIN_PUB_KEY_FROM);
    console.log("Balance:", balance);

    const withdrawalResult = await withdrawal(
      process.env.MAIN_PUB_KEY_FROM,
      process.env.MAIN_PUB_KEY_TO,
      0.1 // bitcoin unit
    );
    console.log("Withdrawal result:", withdrawalResult);

    const transaction = await checkTransaction(process.env.SAMPLE_MAIN_TXID);
    console.log("Transaction:", transaction);
  } catch (error) {
    console.error("Error:", error);
  }
})();

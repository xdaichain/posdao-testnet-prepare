// This script creates `scripts/set-env.sh` file to set environment variables for
// `posdao-contracts/scripts/make_spec.js`.
// It uses process env variables to get base data.

const fs = require('fs');
const hexgen = require('hex-generator');
const secp256k1 = require('secp256k1');
const Web3 = require('web3');
const web3 = new Web3();

main();

async function main() {
  const setEnvFilepath = `${__dirname}/../scripts/set-env.sh`;
  const nodesSpecFilePath = `${__dirname}/../nodes/spec.json`;

  if (fs.existsSync(setEnvFilepath)) {
    console.log('set-env.sh already exists. Skipping this step');
    return;
  } else if (fs.existsSync(nodesSpecFilePath)) {
    console.log('spec.json already exists. Skipping this step');
    return;
  }

  const networkName = (process.env.NETWORK_NAME || "xdaitestnet").trim();
  const networkId = (process.env.NETWORK_ID || "102").trim();
  const ownerBalance = (process.env.OWNER_BALANCE || "100").trim(); // default is 100 * 10**18 wei
  const delegatorMinStake = (process.env.DELEGATOR_MIN_STAKE || "200").trim(); // default is 200 * 10**18 wei
  const candidateMinStake = (process.env.CANDIDATE_MIN_STAKE || "2000").trim(); // default is 2000 * 10**18 wei
  const validatorsNumber = process.env.VALIDATORS_NUMBER || 5;

  // Validate input parameters
  const networkNameTest = /^[a-zA-Z0-9]+$/.test(networkName);
  if (!networkNameTest) {
    throw Error("NETWORK_NAME must only contain a-z symbols and digits");
  }
  const networkIdTest = /^[0-9]+$/.test(networkId);
  if (!networkIdTest) {
    throw Error("Invalid NETWORK_ID. Must be integer");
  }
  const ownerBalanceTest = /^[0-9]+$/.test(ownerBalance);
  if (!ownerBalanceTest || ownerBalance == 0) {
    throw Error("Invalid OWNER_BALANCE. Must be positive integer");
  }
  const delegatorMinStakeTest = /^[0-9]+$/.test(delegatorMinStake);
  if (!delegatorMinStakeTest || delegatorMinStake == 0) {
    throw Error("Invalid DELEGATOR_MIN_STAKE. Must be positive integer");
  }
  const candidateMinStakeTest = /^[0-9]+$/.test(candidateMinStake);
  if (!candidateMinStakeTest || candidateMinStake == 0) {
    throw Error("Invalid CANDIDATE_MIN_STAKE. Must be positive integer");
  }
  if (validatorsNumber <= 0 || validatorsNumber > 19) {
    throw Error("Invalid VALIDATORS_NUMBER. Must be in the range 1...19");
  }

  const keysDirectory = `${__dirname}/../keys`;
  try {
    fs.mkdirSync(keysDirectory);
  } catch (e) {}

  // Generate owner key
  const ownerKey = generatePrivateKey();
  const ownerAccount = web3.eth.accounts.privateKeyToAccount(ownerKey);
  fs.writeFileSync(`${keysDirectory}/${ownerAccount.address}`, ownerKey, 'utf8');

  // Generate validator mining keys
  const initialValidators = [];
  const stakingAddresses = [];
  for (let i = 0; i < validatorsNumber; i++) {
    const miningKey = generatePrivateKey();
    const stakingKey = generatePrivateKey();
    const miningAccount = web3.eth.accounts.privateKeyToAccount(miningKey);
    const stakingAccount = web3.eth.accounts.privateKeyToAccount(stakingKey);
    initialValidators.push(miningAccount.address);
    stakingAddresses.push(stakingAccount.address);
    fs.writeFileSync(`${keysDirectory}/${miningAccount.address}`, miningKey, 'utf8');
    fs.writeFileSync(`${keysDirectory}/${stakingAccount.address}`, stakingKey, 'utf8');
  }

  const setEnvContent = `
#!/bin/bash
set -a
NETWORK_NAME=${networkName}
NETWORK_ID=${networkId}
OWNER=${ownerAccount.address}
OWNER_BALANCE=${ownerBalance}
INITIAL_VALIDATORS=${initialValidators}
STAKING_ADDRESSES=${stakingAddresses}
STAKING_EPOCH_DURATION=120992
STAKE_WITHDRAW_DISALLOW_PERIOD=4332
COLLECT_ROUND_LENGTH=76
IS_TESTNET=true
DELEGATOR_MIN_STAKE=${delegatorMinStake}
CANDIDATE_MIN_STAKE=${candidateMinStake}
  `.trim();

  console.log('Saving scripts/set-env.sh file ...');
  fs.writeFileSync(setEnvFilepath, setEnvContent, 'utf8');
  console.log('Done');
}

function generatePrivateKey() {
  let key;
  do {
    key = hexgen(256);
  } while (!secp256k1.privateKeyVerify(Uint8Array.from(web3.utils.hexToBytes(`0x${key}`))));
  return key;
}

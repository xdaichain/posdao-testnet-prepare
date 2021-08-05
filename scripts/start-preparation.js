// This script modifies `posdao-contracts/spec.json` file
// and copies it to the `nodes` directory, prepares docker-compose.yml files
// for Netstat server, validator nodes, archive/RPC node.

const fs = require('fs');
const pwdgen = require('generate-password');
const hexgen = require('hex-generator');
const publicIp = require('public-ip');
const secp256k1 = require('secp256k1');
const solc = require('solc');
const Web3 = require('web3');
const web3 = new Web3();
const BN = web3.utils.BN;

const nodesDirectory = `${__dirname}/../nodes`;
const nodesSpecFilePath = `${nodesDirectory}/spec.json`;

main();

async function main() {
  const externalIP = await publicIp.v4();
  const setEnvContent = fs.readFileSync(`${__dirname}/../scripts/set-env.sh`, 'utf8')
  const networkName = setEnvContent.match(/NETWORK_NAME=([a-zA-Z0-9]+)/)[1];
  const ownerAddress = setEnvContent.match(/OWNER=([a-fA-F0-9x]+)/)[1];
  const miningAddresses = setEnvContent.match(/INITIAL_VALIDATORS=([a-fA-F0-9x,]+)/)[1].split(',');

  if (fs.existsSync(nodesSpecFilePath)) {
    console.log('spec.json file already exists, so we are trying to deploy staking token contract and make initial stakes if needed...');
    web3.setProvider(`http://${externalIP}:8545`);
    await deployStakingToken(ownerAddress);
    return;
  }

  let spec = fs.readFileSync(`${__dirname}/../posdao-contracts/spec.json`, 'utf8');
  spec = JSON.parse(spec);

  // Remove unrelevant options from spec
  delete spec.engine.authorityRound.params.blockGasLimitContractTransitions;

  // Correct existing options in spec
  spec.genesis.gasLimit = '30000000';

  // Add London hard fork options
  spec.params.eip1559Transition = "0";
  spec.params.eip3198Transition = "0";
  spec.params.eip3529Transition = "0";
  spec.params.eip3541Transition = "0";
  spec.params.eip1559BaseFeeMaxChangeDenominator = "0x8";
  spec.params.eip1559ElasticityMultiplier = "0x2";
  spec.params.eip1559BaseFeeInitialValue = "0x3b9aca00";

  // Generate Enode URLs
  spec.nodes = [];
  for (let n = 0; n <= miningAddresses.length; n++) {
    const address = (n == 0) ? ownerAddress : miningAddresses[n - 1];
    const privateKey = fs.readFileSync(`${__dirname}/../keys/${address}`, 'utf8');
    const publicKey = secp256k1.publicKeyCreate(Buffer.from(privateKey, 'hex'), false);
    const enodePubKey = web3.utils.stripHexPrefix(web3.utils.bytesToHex(publicKey.slice(1)));
    const enodeURL = `enode://${enodePubKey}@${externalIP}:3030${n}`;
    spec.nodes.push(enodeURL);
  }

  // Save spec to file
  try {
    fs.mkdirSync(nodesDirectory);
  } catch (e) {}
  fs.writeFileSync(nodesSpecFilePath, JSON.stringify(spec, null, '  '), 'utf8');

  // Prepare docker-compose.yml for Netstat
  const ETHSTATS_SECRET = pwdgen.generate({ length: 10, numbers: true });

  const ethstatsPort = 3000;
  const ethstatsDirectory = `${nodesDirectory}/ethstats`;
  try {
    fs.mkdirSync(ethstatsDirectory);
  } catch (e) {}

  const ethstatsYmlContent = `
version: '3.7'
services:
  ethstats:
    init: true
    image: swarmpit/ethstats:latest
    container_name: ethstats
    restart: always
    environment:
      WS_SECRET: "${ETHSTATS_SECRET}"
      PORT: ${ethstatsPort}
    ports:
      - "${ethstatsPort}:${ethstatsPort}"
    logging:
      options:
        max-size: "1m"
        max-file: "10"
  `.trim();

  fs.writeFileSync(`${ethstatsDirectory}/docker-compose.yml`, ethstatsYmlContent, 'utf8');

  // Prepare docker-compose.yml for each validator node
  for (let n = 0; n < miningAddresses.length; n++) {
    const address = miningAddresses[n];
    const privateKey = fs.readFileSync(`${__dirname}/../keys/${address}`, 'utf8');

    const nodeDirectory = `${nodesDirectory}/validator${n+1}`;
    try {
      fs.mkdirSync(nodeDirectory);
    } catch (e) {}

    const ethstatsName = `Validator${n+1} on ${networkName}`;

    const nodeYmlContent = `
version: '3.7'
services:
  nethermind:
    init: true
    container_name: ${networkName}-validator${n+1}
    image: nethermind/nethermind:latest
    environment:
      NETHERMIND_AURACONFIG_ALLOWAURAPRIVATECHAINS: "true"
      NETHERMIND_AURACONFIG_FORCESEALING: "true"
      NETHERMIND_AURACONFIG_TXPRIORITYCONTRACTADDRESS: "0x4100000000000000000000000000000000000000"
      NETHERMIND_ETHSTATSCONFIG_ENABLED: "true"
      NETHERMIND_ETHSTATSCONFIG_SERVER: "ws://${externalIP}:${ethstatsPort}/api"
      NETHERMIND_ETHSTATSCONFIG_SECRET: "${ETHSTATS_SECRET}"
      NETHERMIND_ETHSTATSCONFIG_CONTACT: "security@poanetwork.com"
      NETHERMIND_ETHSTATSCONFIG_NAME: "${ethstatsName}"
      NETHERMIND_INITCONFIG_CHAINSPECPATH: "/nethermind/spec.json"
      NETHERMIND_INITCONFIG_ISMINING: "true"
      NETHERMIND_INITCONFIG_STORERECEIPTS: "false"
      NETHERMIND_KEYSTORECONFIG_TESTNODEKEY: "${privateKey}"
      NETHERMIND_METRICSCONFIG_ENABLED: "true"
      NETHERMIND_METRICSCONFIG_NODENAME: "${ethstatsName}"
      NETHERMIND_METRICSCONFIG_PUSHGATEWAYURL: https://metrics.nethermind.io/metrics/validators-Ifa0eigee0deigah8doo5aisaeNa8huichahk5baip2daitholaeh4xiey0iec1vai6Nahxae1aeregul5Diehae7aeThengei7X
      NETHERMIND_METRICSCONFIG_INTERVALSECONDS: 30
      NETHERMIND_MININGCONFIG_MINGASPRICE: "1000000000"
      NETHERMIND_MININGCONFIG_TARGETBLOCKGASLIMIT: "${spec.genesis.gasLimit}"
      NETHERMIND_NETWORKCONFIG_DISCOVERYPORT: 3030${n+1}
      NETHERMIND_NETWORKCONFIG_P2PPORT: 3030${n+1}
      NETHERMIND_PRUNINGCONFIG_ENABLED: "false"
      NETHERMIND_SEQCONFIG_MINLEVEL: "Info"
      NETHERMIND_SEQCONFIG_SERVERURL: "https://seq.nethermind.io"
      NETHERMIND_SEQCONFIG_APIKEY: "${process.env.SEQAPIKEY}"
      NETHERMIND_SYNCCONFIG_FASTSYNC: "false"
      NETHERMIND_SYNCCONFIG_FASTBLOCKS: "false"
      NETHERMIND_SYNCCONFIG_DOWNLOADBODIESINFASTSYNC: "false"
      NETHERMIND_SYNCCONFIG_DOWNLOADRECEIPTSINFASTSYNC: "false"
    volumes:
      - ../spec.json:/nethermind/spec.json:ro
      - ./data/logs:/nethermind/logs
      - ./data/keystore:/nethermind/keystore
      - ./data/nethermind_db:/nethermind/nethermind_db
    ports:
      - "3030${n+1}:3030${n+1}"
      - "3030${n+1}:3030${n+1}/udp"
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "10"
    `.trim();

    fs.writeFileSync(`${nodeDirectory}/docker-compose.yml`, nodeYmlContent, 'utf8');
  }

  // Prepare docker-compose.yml for archive/RPC node
  const ownerPrivateKey = fs.readFileSync(`${__dirname}/../keys/${ownerAddress}`, 'utf8');

  const archiveEthstatsName = `Archive/RPC on ${networkName}`;
  const archiveNodeDirectory = `${nodesDirectory}/archive`;
  try {
    fs.mkdirSync(archiveNodeDirectory);
  } catch (e) {}

  const archiveNodeYmlContent = `
version: '3.7'
services:
  nethermind:
    init: true
    container_name: ${networkName}-archive
    image: nethermind/nethermind:latest
    environment:
      NETHERMIND_AURACONFIG_ALLOWAURAPRIVATECHAINS: "true"
      NETHERMIND_ETHSTATSCONFIG_ENABLED: "true"
      NETHERMIND_ETHSTATSCONFIG_CONTACT: "security@poanetwork.com"
      NETHERMIND_ETHSTATSCONFIG_NAME: "${archiveEthstatsName}"
      NETHERMIND_ETHSTATSCONFIG_SECRET: "${ETHSTATS_SECRET}"
      NETHERMIND_ETHSTATSCONFIG_SERVER: "ws://${externalIP}:${ethstatsPort}/api"
      NETHERMIND_INITCONFIG_CHAINSPECPATH: "/nethermind/spec.json"
      NETHERMIND_INITCONFIG_ISMINING: "false"
      NETHERMIND_INITCONFIG_STORERECEIPTS: "true"
      NETHERMIND_INITCONFIG_WEBSOCKETSENABLED: "true"
      NETHERMIND_JSONRPCCONFIG_ENABLED: "true"
      NETHERMIND_JSONRPCCONFIG_ENABLEDMODULES: "[Eth,Subscribe,Web3,Net,Parity]"
      NETHERMIND_JSONRPCCONFIG_HOST: 0.0.0.0
      NETHERMIND_JSONRPCCONFIG_PORT: 8545
      NETHERMIND_JSONRPCCONFIG_REPORTINTERVALSECONDS: 600
      NETHERMIND_JSONRPCCONFIG_WEBSOCKETSPORT: 8546
      NETHERMIND_KEYSTORECONFIG_ENODEKEYFILE: "/nethermind/enode.key"
      NETHERMIND_METRICSCONFIG_ENABLED: "true"
      NETHERMIND_METRICSCONFIG_INTERVALSECONDS: 30
      NETHERMIND_METRICSCONFIG_NODENAME: "${archiveEthstatsName}"
      NETHERMIND_METRICSCONFIG_PUSHGATEWAYURL: https://metrics.nethermind.io/metrics/validators-Ifa0eigee0deigah8doo5aisaeNa8huichahk5baip2daitholaeh4xiey0iec1vai6Nahxae1aeregul5Diehae7aeThengei7X
      NETHERMIND_NETWORKCONFIG_EXTERNALIP: ${externalIP}
      NETHERMIND_NETWORKCONFIG_DISCOVERYPORT: 30300
      NETHERMIND_NETWORKCONFIG_P2PPORT: 30300
      NETHERMIND_SEQCONFIG_MINLEVEL: "Info"
      NETHERMIND_SEQCONFIG_SERVERURL: "https://seq.nethermind.io"
      NETHERMIND_SEQCONFIG_APIKEY: "${process.env.SEQAPIKEY}"
      NETHERMIND_SYNCCONFIG_FASTSYNC: "false"
      NETHERMIND_SYNCCONFIG_FASTBLOCKS: "true"
      NETHERMIND_SYNCCONFIG_FASTSYNCCATCHUPHEIGHTDELTA: 100000
      NETHERMIND_SYNCCONFIG_DOWNLOADBODIESINFASTSYNC: "true"
      NETHERMIND_SYNCCONFIG_DOWNLOADRECEIPTSINFASTSYNC: "true"
    volumes:
      - ../spec.json:/nethermind/spec.json:ro
      - ./data/logs:/nethermind/logs
      - ./data/keystore:/nethermind/keystore
      - ./data/nethermind_db:/nethermind/nethermind_db
      - ./enode.key:/nethermind/enode.key:ro
    ports:
      - "8545:8545"
      - "8546:8546"
      - "30300:30300"
      - "30300:30300/udp"
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "1"
  `.trim();

  fs.writeFileSync(`${archiveNodeDirectory}/docker-compose.yml`, archiveNodeYmlContent, 'utf8');
  fs.writeFileSync(`${archiveNodeDirectory}/enode.key`, Buffer.from(ownerPrivateKey, 'hex'), 'binary');

  // Make `nodes/run_all.sh` script
  const runAllShContent = `
#!/bin/bash
docker pull swarmpit/ethstats:latest
docker pull nethermind/nethermind:latest
cd ./ethstats; docker-compose up -d; cd -
sleep 5
for i in $(seq 1 ${miningAddresses.length}); do
  cd ./validator$\{i\}; docker-compose up -d; cd -
  sleep 3
done
cd ./archive; docker-compose up -d; cd -
  `.trim();
  fs.writeFileSync(`${nodesDirectory}/run_all.sh`, runAllShContent, 'utf8');

  // Make `nodes/stop_all.sh` script
  const stopAllShContent = `
#!/bin/bash
cd ./ethstats; docker-compose down; cd -
for i in $(seq 1 ${miningAddresses.length}); do
  cd ./validator$\{i\}; docker-compose down; cd -
done
cd ./archive; docker-compose down; cd -
  `.trim();
  fs.writeFileSync(`${nodesDirectory}/stop_all.sh`, stopAllShContent, 'utf8');
}

function compileStakingTokenContract() {
  let input = {
    language: 'Solidity',
    sources: {
      'token.sol': {
        content: fs.readFileSync(`${__dirname}/../posdao-contracts/contracts/ERC677BridgeTokenRewardable.sol`, 'utf8'),
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['*'],
        },
      },
    },
  };
  let compiledContract = JSON.parse( solc.compile(JSON.stringify(input)) );
  return compiledContract.contracts['token.sol']['ERC677BridgeTokenRewardable'];
}

async function deployStakingToken(ownerAddress) {
  let spec = fs.readFileSync(nodesSpecFilePath, 'utf8');
  spec = JSON.parse(spec);
  const validatorSetAuRaAddress = spec.engine.authorityRound.params.validators.multi["0"].contract;
  const blockRewardAuRaAddress = spec.engine.authorityRound.params.blockRewardContractAddress;
  const validatorSetAuRaContract = new web3.eth.Contract([{"constant":true,"inputs":[],"name":"stakingContract","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"getValidators","outputs":[{"name":"","type":"address[]"}],"payable":false,"stateMutability":"view","type":"function"}], validatorSetAuRaAddress);
  const stakingAuRaAddress = await validatorSetAuRaContract.methods.stakingContract().call();
  const stakingAuRaContract = new web3.eth.Contract([{"constant":true,"inputs":[],"name":"erc677TokenContract","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"stakingEpoch","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_erc677TokenContract","type":"address"}],"name":"setErc677TokenContract","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_totalAmount","type":"uint256"}],"name":"initialValidatorStake","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"candidateMinStake","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}], stakingAuRaAddress);
  const stakingTokenAddress = await stakingAuRaContract.methods.erc677TokenContract().call();
  const stakingEpoch = new BN(await stakingAuRaContract.methods.stakingEpoch().call());
  const candidateMinStake = new BN(await stakingAuRaContract.methods.candidateMinStake().call());
  if (stakingTokenAddress == '0x0000000000000000000000000000000000000000' && stakingEpoch.isZero()) {
    // Deploy staking token contract and make initial stakes

    const compiledContract = compileStakingTokenContract();
    const abi = compiledContract.abi;
    const bytecode = compiledContract.evm.bytecode.object;
    const contract = new web3.eth.Contract(abi);
    const netId = await web3.eth.getChainId();
    const data = await contract
      .deploy({
          data: '0x' + bytecode,
          arguments: ['STAKE', 'STAKE', 18, netId],
      })
      .encodeABI();
    const ownerPrivateKey = fs.readFileSync(`${__dirname}/../keys/${ownerAddress}`, 'utf8');

    let signedTx = await web3.eth.accounts.signTransaction({
      data,
      gasPrice: web3.utils.numberToHex('0'),
      gas: web3.utils.numberToHex('4700000'),
    }, `0x${ownerPrivateKey}`);
    let receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    console.log(`Staking token contract is deployed and has the address ${receipt.contractAddress}`);

    // Call StakingTokenContract.setStakingContract()
    const stakingTokenContract = new web3.eth.Contract([{"constant":false,"inputs":[{"name":"_stakingContract","type":"address"}],"name":"setStakingContract","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_blockRewardContract","type":"address"}],"name":"setBlockRewardContract","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_to","type":"address"},{"name":"_amount","type":"uint256"}],"name":"mint","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"}], receipt.contractAddress);
    signedTx = await web3.eth.accounts.signTransaction({
      to: stakingTokenContract.options.address,
      data: stakingTokenContract.methods.setStakingContract(stakingAuRaAddress).encodeABI(),
      gasPrice: web3.utils.numberToHex('0'),
      gas: web3.utils.numberToHex('2000000'),
    }, `0x${ownerPrivateKey}`);
    receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    if (receipt.status !== true) {
      throw Error("Cannot call StakingTokenContract.setStakingContract() function");
    } else {
      console.log("StakingTokenContract.setStakingContract() was called successfully");
    }

    // Call StakingTokenContract.setBlockRewardContract()
    signedTx = await web3.eth.accounts.signTransaction({
      to: stakingTokenContract.options.address,
      data: stakingTokenContract.methods.setBlockRewardContract(blockRewardAuRaAddress).encodeABI(),
      gasPrice: web3.utils.numberToHex('0'),
      gas: web3.utils.numberToHex('2000000'),
    }, `0x${ownerPrivateKey}`);
    receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    if (receipt.status !== true) {
      throw Error("Cannot call StakingTokenContract.setBlockRewardContract() function");
    } else {
      console.log("StakingTokenContract.setBlockRewardContract() was called successfully");
    }

    // Call StakingAuRa.setErc677TokenContract()
    signedTx = await web3.eth.accounts.signTransaction({
      to: stakingAuRaContract.options.address,
      data: stakingAuRaContract.methods.setErc677TokenContract(stakingTokenContract.options.address).encodeABI(),
      gasPrice: web3.utils.numberToHex('0'),
      gas: web3.utils.numberToHex('2000000'),
    }, `0x${ownerPrivateKey}`);
    receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    if (receipt.status !== true) {
      throw Error("Cannot call StakingAuRa.setErc677TokenContract() function");
    } else {
      console.log("StakingAuRa.setErc677TokenContract() was called successfully");
    }

    // Call StakingTokenContract.mint()
    const miningAddresses = validatorSetAuRaContract.methods.getValidators().call();
    const mintAmount = candidateMinStake.mul(new BN(miningAddresses.length));
    signedTx = await web3.eth.accounts.signTransaction({
      to: stakingTokenContract.options.address,
      data: stakingTokenContract.methods.mint(stakingAuRaAddress, mintAmount).encodeABI(),
      gasPrice: web3.utils.numberToHex('0'),
      gas: web3.utils.numberToHex('2000000'),
    }, `0x${ownerPrivateKey}`);
    receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    if (receipt.status !== true) {
      throw Error("Cannot call StakingTokenContract.mint() function");
    } else {
      console.log("StakingTokenContract.mint() was called successfully");
    }

    // Call StakingAuRa.initialValidatorStake()
    signedTx = await web3.eth.accounts.signTransaction({
      to: stakingAuRaContract.options.address,
      data: stakingAuRaContract.methods.initialValidatorStake(mintAmount).encodeABI(),
      gasPrice: web3.utils.numberToHex('0'),
      gas: web3.utils.numberToHex('2000000'),
    }, `0x${ownerPrivateKey}`);
    receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    if (receipt.status !== true) {
      throw Error("Cannot call StakingAuRa.initialValidatorStake() function");
    } else {
      console.log("StakingAuRa.initialValidatorStake() was called successfully");
    }

    console.log('Initial stakes for validators were successfully set');
  } else if (stakingTokenAddress != '0x0000000000000000000000000000000000000000') {
    console.log('The staking token is already deployed, so we are skipping this step');
  } else if (!stakingEpoch.isZero()) {
    console.log('The number of the current staking epoch is not zero, so it is too late to make initial stakes. Skipping this step');
  }
}

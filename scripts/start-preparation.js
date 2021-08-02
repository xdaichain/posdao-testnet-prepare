// This script modifies `posdao-contracts/spec.json` file
// and copies it to the `nodes` directory, prepares docker-compose.yml files
// for Netstat server, validator nodes, archive/RPC node.

const fs = require('fs');
const pwdgen = require('generate-password');
const hexgen = require('hex-generator');
const publicIp = require('public-ip');
const secp256k1 = require('secp256k1');
const Web3 = require('web3');
const web3 = new Web3();

main();

async function main() {
  let spec = fs.readFileSync(`${__dirname}/../posdao-contracts/spec.json`, 'utf8');
  spec = JSON.parse(spec);

  // Remove unrelevant options from spec
  delete spec.engine.authorityRound.params.blockGasLimitContractTransitions;

  const setEnvContent = fs.readFileSync(`${__dirname}/../scripts/set-env.sh`, 'utf8')
  const networkName = setEnvContent.match(/NETWORK_NAME=([a-zA-Z0-9]+)/)[1];
  const ownerAddress = setEnvContent.match(/OWNER=([a-fA-F0-9x]+)/)[1];
  const miningAddresses = setEnvContent.match(/INITIAL_VALIDATORS=([a-fA-F0-9x,]+)/)[1].split(',');

  // Generate Enode URLs
  spec.nodes = [];
  const externalIP = await publicIp.v4();
  for (let n = 0; n <= miningAddresses.length; n++) {
    const address = (n == 0) ? ownerAddress : miningAddresses[n - 1];
    const privateKey = fs.readFileSync(`${__dirname}/../keys/${address}`, 'utf8');
    const publicKey = secp256k1.publicKeyCreate(Buffer.from(privateKey, 'hex'), false);
    const enodePubKey = web3.utils.stripHexPrefix(web3.utils.bytesToHex(publicKey.slice(1)));
    const enodeURL = `enode://${enodePubKey}@${externalIP}:3030${n}`;
    spec.nodes.push(enodeURL);
  }

  const nodesDirectory = `${__dirname}/../nodes`;

  // Save spec to file
  try {
    fs.mkdirSync(nodesDirectory);
  } catch (e) {}
  fs.writeFileSync(`${nodesDirectory}/spec.json`, JSON.stringify(spec, null, '  '), 'utf8');

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
    image: poanetwork/ethstats:latest
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
      NETHERMIND_MININGCONFIG_TARGETBLOCKGASLIMIT: "17000000"
      NETHERMIND_NETWORKCONFIG_DISCOVERYPORT: 3030${n+1}
      NETHERMIND_NETWORKCONFIG_P2PPORT: 3030${n+1}
      NETHERMIND_PRUNINGCONFIG_ENABLED: "true"
      NETHERMIND_SEQCONFIG_MINLEVEL: "Info"
      NETHERMIND_SEQCONFIG_SERVERURL: "https://seq.nethermind.io"
      NETHERMIND_SEQCONFIG_APIKEY: "${process.env.SEQAPIKEY}"
      NETHERMIND_SYNCCONFIG_FASTSYNC: "true"
      NETHERMIND_SYNCCONFIG_FASTBLOCKS: "true"
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
      NETHERMIND_JSONRPCCONFIG_HOST: 0.0.0.0
      NETHERMIND_JSONRPCCONFIG_PORT: 8545
      NETHERMIND_JSONRPCCONFIG_REPORTINTERVALSECONDS: 600
      NETHERMIND_JSONRPCCONFIG_WEBSOCKETSPORT: 8546
      NETHERMIND_KEYSTORECONFIG_ENODEACCOUNT: "${ownerAddress}"
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

  // Make `nodes/run_all.sh` script
  const runAllShContent = `
#!/bin/bash
docker pull poanetwork/ethstats:latest
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
}

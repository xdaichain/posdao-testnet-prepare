# POSDAO Testnet Prepare

Preparation scripts and a launcher of POSDAO testchain. It runs validator nodes, archive/rpc node, and netstat dashboard on a single server in docker containers. The number of validator nodes is configurable.

The setup is wrapped to docker image. The current version only uses Nethermind client to run the nodes.

## Build

```bash
git clone https://github.com/xdaichain/posdao-testnet-prepare
cd posdao-testnet-prepare
docker build -t poanetwork/posdao-testnet-prepare .
```

This will create the docker image to use it as described below.

## Usage

The setup assumes a few steps to run the testchain:
- configuring and automatic creation of `docker-compose.yml` files for all nodes, preparing spec.json file
- running the testchain from scratch
- deploying staking token contract after the chain starts

1. Clone this repository and go to the `compose` directory:

```bash
git clone https://github.com/xdaichain/posdao-testnet-prepare
cd posdao-testnet-prepare/compose
```

2. Configure environment variables before starting the preparation scripts.

```bash
cp .env.example .env
nano .env # or use your favorite text editor
```

The config parameters are (default values can be left as is):

- `NETWORK_NAME` - testnet name written to spec.json file and used in autogenerated `docker-compose.yml` files for nodes.
- `NETWORK_ID` - network ID of the testchain.
- `OWNER_BALANCE` - number of coins available for the owner account (in 10**18 wei). This account will be generated automatically.
- `DELEGATOR_MIN_STAKE` - minimum number of staking tokens needed to be a POSDAO delegator (in 10**18 wei).
- `CANDIDATE_MIN_STAKE` - minimum number of staking tokens needed to be a POSDAO candidate (in 10**18 wei).
- `STAKING_EPOCH_DURATION` - the duration of POSDAO staking epoch in blocks.
- `STAKE_WITHDRAW_DISALLOW_PERIOD` - the duration period (in blocks) at the end of staking epoch during which participants are not allowed to stake/withdraw/order/claim their staking tokens.
- `COLLECT_ROUND_LENGTH` - the length of the randomness collection round (in blocks).
- `VALIDATORS_NUMBER` - the number of initial validators (up to 21 in the current version).
- `SEQAPIKEY` - an API key for [Seq](https://datalust.co/seq) log collector. Used on Nethermind nodes to collect logs useful for debugging purposes.

3. Run preparation scripts.

This step will create `nodes` subdirectory in the `compose` directory.

```bash
pwd # make sure your are in the `compose` directory
docker-compose up
```

The appeared `nodes` directory will contain the following subdirectories and files:
- `archive` - the directory for archive/rpc node.
- `ethstats` - the directory for Netstats dashboard.
- `validatorN` - the directory for validator N node where N is the number of validator.
- `spec.json` - the spec file used by all nodes.
- `run_all.sh` - the script to run all nodes and Netstats dashboard (to up their docker containers).
- `stop_all.sh` - the script to stop all nodes and Netstats dashboard (to down their docker containers).

4. Start all nodes.

```bash
cd nodes
chmod +x run_all.sh
./run_all.sh
```

This will create and start all docker containers.

5. Deploy staking token contract and make initial stakes by validators.

This step must be launched until the first staking epoch is finished.

```bash
cd .. # go back to the `compose` directory
docker-compose start && docker-compose logs -f
```

6. Get owner's address and private key.

After the chain starts, only owner account will have positive balance in native coins. 

To get owner's address:

```bash
pwd # make sure your are in the `compose` directory
docker-compose start && docker exec testnetprep cat /testnet/scripts/set-env.sh | grep OWNER=
```

To get owner's private key:

```bash
docker-compose start && docker exec testnetprep cat /testnet/keys/{OWNER_ADDRESS} # insert here the address got on the previous substep
```

7. Try to view Netstats dashboard and connect to RPC:

Netstat is available on `http://[EXTERNAL_IP]:3000`.
RPC is available on `http://[EXTERNAL_IP]:8545`.

## Restarting nodes

If you need to restart a node, go to its subdirectory inside the `compose/nodes` directory, and run

```bash
docker-compose down
docker-compose up -d
```

## Cleanup

If you need to stop all containers and remove them:

```bash
cd compose/nodes
chmod +x stop_all.sh
./stop_all.sh
cd .. # go back to the `compose` directory
docker-compose down
rm -rf nodes # to remove the testchain
```
FROM node:12-alpine

WORKDIR /testnet

COPY .git ./.git
COPY .gitmodules ./.gitmodules
COPY scripts ./scripts
COPY package*.json ./

RUN apk update && apk upgrade && \
    apk add --no-cache git python3 py3-pip make g++

ENTRYPOINT ["npm","run"]
CMD ["start"]

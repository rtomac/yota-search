# Overview

Automates a Toyota inventory search using a web browser and exports a single query of inventory data into a structured format.

**This project is not affiliated with or endorsed by Toyota.**

Toyota has made it virtually impossible to call their GraphQL APIs directly (via WAF with intelligent threat detection), undestandably, to prevent unauthorized scraping. But that makes it difficult for motivated buyers to analyze and keep up on inventory for high-demand models, as the website is extremely cumbersome to point-and-click through (especially if you're looking for a specified option) and doesn't provide an option to be noified when new vehicles are added.

This tool is intended for *personal use* to automate a single query of inventory data and export it into a JSON or CSV format for analysis. It does so via web browser so as not to circumvent Toyota's intended use for their APIs.

# Usage

## Running locally (browser visible)

#### Requirements
- Node.js

#### Install
```
npm install
```

#### Run
```
npm run start
```

#### Run with args
```
npm run start -- --model corolla --zipcode 97204 --distance 100 --csv ./out/inventory.csv --json ./out/inventory.json
```

## Running via container (hidden browser)

#### Requirements
- Docker

#### Build
```
make build
```

#### Run
```
make run
```

#### Run with args
```
MODEL=corolla ZIPCODE=97204 DISTANCE=100 CSV=out/inventory.csv JSON=out/inventory.json make run
```

## Running via published Docker image

The app is published as a multi-arch image to Docker hub [here](https://hub.docker.com/r/rtomac/yota-search).

#### Run
```
docker run -it \
    -e MODEL=corolla \
    -e ZIPCODE=97204 \
    -e DISTANCE=100 \
    -e CSV=out/inventory.csv \
    -e JSON=out/inventory.json \
    -v ./out:/root/app/out \
    rtomac/yota-search:latest
```

# License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

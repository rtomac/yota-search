# Overview

Automates navigation of Toyota's inventory search via a GUI browser to export a single query of inventory data into a structured format.

Toyota seems to have gone to great lengths (e.g. AWS WAF intelligent threat mitigation) to prevent scraping of inventory data and this isn't meant to circumvent that. It is simply for personal use for those aiming to analyze local inventory for a particular model. (The website is rather cumbersome to search with and click through if you're looking for a specific option, e.g. bench seat.)

## Running locally (visible browser)

#### Requirements
`node` and `npm`

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
`docker`

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

The app is published as a multi-arch image to Docker hub [here](https://hub.docker.com/r/rtomac/toyota-inventory).

#### Run
```
docker run -it \
    -e MODEL=corolla \
    -e ZIPCODE=97204 \
    -e DISTANCE=100 \
    -e CSV=out/inventory.csv \
    -e JSON=out/inventory.json \
    -v ./out:/root/app/out \
    rtomac/toyota-inventory:latest
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.

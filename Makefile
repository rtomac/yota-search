SHELL=/bin/bash

IMAGE_NAME=yota-search
IMAGE_TAG=local
LOGLEVEL?=info

.PHONY: setup
setup:
	npm install

.PHONY: start
start:
	npm run start

.PHONY: build
build:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

.PHONY: run
run:
	docker run -it \
		-e MODEL=$(MODEL) \
		-e ZIPCODE=$(ZIPCODE) \
		-e DISTANCE=$(DISTANCE) \
		-e CSV=$(CSV) \
		-e JSON=$(JSON) \
		-e LOGLEVEL=$(LOGLEVEL) \
		-v ./src:/root/app/src \
		-v ./out:/root/app/out \
		-v ./start.sh:/root/app/start.sh \
		$(IMAGE_NAME):$(IMAGE_TAG)

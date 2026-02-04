# Pi-r2 0.3

* NodeJS 18.20 LTS
* ES2022

> [!CAUTION]
> Unless otherwise noted any `@pi-r2` packages are unmaintained and untested. They are republished once with each **NodeJS LTS** and `@e-mc` turnover to sustain minimum compatibility.

## General Usage

* [E-mc](https://e-mc.readthedocs.io/en/latest/document/plugins)

## Document

* [@pi-r2/clean-css](https://github.com/jakubpawlowicz/clean-css)
* [@pi-r2/csso](https://github.com/css/csso)
* [@pi-r2/html-minifier](https://github.com/kangax/html-minifier)
* [@pi-r2/html-minifier-terser](https://github.com/DanielRuf/html-minifier-terser)
* [@pi-r2/svgo](https://github.com/svg/svgo)
* [@pi-r2/uglify-js](https://github.com/mishoo/UglifyJS)

## Cloud

* [@pi-r2/ibm](https://www.ibm.com/cloud/free)
* [@pi-r2/minio](https://min.io)

# Pi-r 0.11

## Db

### Redis

* [@pi-r/redis](https://e-mc.readthedocs.io/en/latest/db/redis.html)
* redis/docker

```sh
docker build -f docker/redis.Dockerfile --tag squared:redis .
docker run -d --name redis --rm -p 6379:6379 \
       --mount type=bind,source=$PWD/docker/app/redis.js,target=/client/redis/app.js squared:redis
docker exec -it -e 'REDIS_KEY=["card:1", "card:2"]' -e 'REDIS_PATH=$.description' redis rundb
```

## Image

* [@pi-r/jimp](https://github.com/jimp-dev/jimp) (worker)

## Compress

* [@pi-r/imagemin](https://github.com/imagemin/imagemin) (worker)

## LICENSE

MIT

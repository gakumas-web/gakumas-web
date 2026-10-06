FROM python:3.13-alpine AS build
WORKDIR /build
COPY tools/build.py tools/resource_release.py tools/content_contract.py tools/install_content.py tools/image_delivery.py tools/
COPY index.html app.mjs style.css i18n.mjs resources.mjs image-config.mjs content-config.mjs package.json ./
COPY LICENSE THIRD_PARTY.md ./
COPY application/ application/
COPY domain/ domain/
COPY ui/ ui/
COPY locales/ locales/
COPY resources/content-source.json resources/asset-lock.json resources/
RUN python -B tools/build.py

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 8080

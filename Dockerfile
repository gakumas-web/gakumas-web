FROM python:3.13-alpine AS build
WORKDIR /build
COPY tools/build.py tools/resource_release.py tools/content_contract.py tools/reference_contract.py tools/install_content.py tools/image_delivery.py tools/
COPY index.html startup.js app.mjs style.css i18n.mjs resources.mjs image-config.mjs content-config.mjs package.json ./
COPY LICENSE THIRD_PARTY.md ./
COPY application/ application/
COPY domain/ domain/
COPY ui/ ui/
COPY locales/ locales/
COPY resources/content-source.json resources/asset-lock.json resources/preview-account.json resources/
ARG ENABLE_PREVIEW_ACCOUNT=false
RUN case "$ENABLE_PREVIEW_ACCOUNT" in true) python -B tools/build.py --preview-account ;; false) python -B tools/build.py --no-preview-account ;; *) exit 1 ;; esac

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 8080
